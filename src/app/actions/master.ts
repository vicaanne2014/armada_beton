"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mapDbError } from "@/lib/domain/errors";
import { MASTER } from "@/lib/master-config";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./documents";

type Values = Record<string, string | boolean>;
const fail = (message: string, code = "INVALID_INPUT"): ActionResult<never> => ({ ok: false, error: { code, message } });

export async function saveMasterAction(entity: string, id: string | null, values: Values): Promise<ActionResult> {
  const def = MASTER[entity];
  const s = await getSession();
  if (!def) return fail("Master tidak dikenal.");
  if (!s?.can("master.manage")) return fail("Anda tidak memiliki akses.", "FORBIDDEN");

  const payload: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (id && f.createOnly) continue;
    const raw = values[f.name];
    if (f.type === "bool") {
      payload[f.name] = Boolean(raw);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (f.required) return fail(`${f.label} wajib diisi.`);
      payload[f.name] = null;
      continue;
    }
    if (f.type === "number") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return fail(`${f.label} harus berupa angka (≥ 0).`);
      payload[f.name] = n;
    } else {
      payload[f.name] = text;
    }
  }
  if (typeof payload.code === "string") payload.code = payload.code.toUpperCase();

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from(def.table).update(payload).eq("id", id)
    : await supabase.from(def.table).insert(payload);
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(`/master/${entity}`);
  return { ok: true, data: {} };
}

const LocationSchema = z.object({
  warehouseId: z.string().uuid(),
  id: z.string().uuid().nullable(),
  code: z.string().trim().min(1, "Kode wajib diisi").max(40),
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  typeLabel: z.string().trim().max(40).optional(),
  parentId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

export async function saveLocationAction(raw: unknown): Promise<ActionResult> {
  const parsed = LocationSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const s = await getSession();
  if (!s || !(s.can("master.manage") || s.can("location.manage"))) return fail("Anda tidak memiliki akses.", "FORBIDDEN");

  const supabase = await createClient();
  const row = {
    code: v.code.toUpperCase(),
    name: v.name,
    type_label: v.typeLabel || null,
    parent_id: v.parentId,
    is_active: v.isActive,
  };
  const { error } = v.id
    ? await supabase.from("location").update(row).eq("id", v.id)
    : await supabase.from("location").insert({ ...row, warehouse_id: v.warehouseId });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/master/locations");
  return { ok: true, data: {} };
}

const UserSchema = z.object({
  id: z.string().uuid().nullable(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "Username 3–32 karakter: huruf kecil, angka, titik, strip, underscore").optional(),
  fullName: z.string().trim().min(1, "Nama lengkap wajib diisi").max(120),
  roleId: z.string().uuid("Peran wajib dipilih"),
  departmentId: z.string().uuid().nullable(),
  password: z.string().max(200).optional(),
  isActive: z.boolean(),
  warehouseIds: z.array(z.string().uuid()),
});

export async function saveUserAction(raw: unknown): Promise<ActionResult> {
  const parsed = UserSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const s = await getSession();
  if (!s?.can("user.manage")) return fail("Anda tidak memiliki akses.", "FORBIDDEN");

  const supabase = await createClient();
  let userId = v.id;

  if (!userId) {
    if (!v.username) return fail("Username wajib diisi.");
    if (!v.password || v.password.length < 10) return fail("Password awal minimal 10 karakter.");
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: `${v.username}@wms.local`,
      password: v.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      return fail(/already|registered|exists/i.test(error?.message ?? "") ? "Username sudah dipakai." : "Gagal membuat akun login.", "DUPLICATE");
    }
    userId = data.user.id;
    const { error: insErr } = await supabase.from("app_user").insert({
      id: userId,
      username: v.username,
      full_name: v.fullName,
      role_id: v.roleId,
      department_id: v.departmentId,
      is_active: v.isActive,
    });
    if (insErr) {
      await admin.auth.admin.deleteUser(userId); // jangan tinggalkan akun login tanpa profil
      return { ok: false, error: mapDbError(insErr) };
    }
  } else {
    if (userId === s.userId && !v.isActive) return fail("Anda tidak bisa menonaktifkan akun sendiri.");
    const { error } = await supabase
      .from("app_user")
      .update({ full_name: v.fullName, role_id: v.roleId, department_id: v.departmentId, is_active: v.isActive })
      .eq("id", userId);
    if (error) return { ok: false, error: mapDbError(error) };

    const admin = createAdminClient();
    const patch: { password?: string; ban_duration?: string } = { ban_duration: v.isActive ? "none" : "876000h" };
    if (v.password) {
      if (v.password.length < 10) return fail("Password minimal 10 karakter.");
      patch.password = v.password;
    }
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, patch);
    if (authErr) return fail("Profil tersimpan, tetapi akun login gagal diperbarui.", "UNKNOWN");
  }

  // keanggotaan gudang
  const { error: delErr } = await supabase.from("user_warehouse").delete().eq("user_id", userId);
  if (delErr) return { ok: false, error: mapDbError(delErr) };
  if (v.warehouseIds.length) {
    const { error } = await supabase
      .from("user_warehouse")
      .insert(v.warehouseIds.map((w) => ({ user_id: userId, warehouse_id: w })));
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/master/users");
  return { ok: true, data: {} };
}

export async function setFlowStepAction(docType: string, stepOrder: number, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_flow_step_active", {
    p_doc_type: docType,
    p_step_order: stepOrder,
    p_active: active,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/admin/approval-config");
  return { ok: true, data: {} };
}

const DashSchema = z.object({
  userId: z.string().uuid(),
  keys: z.array(z.string()).max(20),
  warehouseId: z.string().uuid().nullable(),
});

export async function saveDashboardAction(raw: unknown): Promise<ActionResult> {
  const parsed = DashSchema.safeParse(raw);
  if (!parsed.success) return fail("Input tidak valid.");
  const s = await getSession();
  if (!s) return fail("Sesi berakhir.", "UNAUTHENTICATED");
  if (parsed.data.userId !== s.userId && !s.can("dashboard.manage_all")) return fail("Anda tidak memiliki akses.", "FORBIDDEN");
  const supabase = await createClient();
  const { error } = await supabase.from("dashboard_config").upsert({
    user_id: parsed.data.userId,
    widgets: { keys: parsed.data.keys, warehouse_id: parsed.data.warehouseId },
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: {} };
}
