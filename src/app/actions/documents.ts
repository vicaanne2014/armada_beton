"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mapDbError, type DomainError } from "@/lib/domain/errors";
import { fmtQty } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = Record<string, never>> =
  | { ok: true; data: T }
  | { ok: false; error: DomainError; savedId?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

// STOCK_OPNAME sengaja tidak ada: sesi opname punya jalur sendiri (actions/opname.ts)
const DOC_TYPES = ["MATERIAL_RECEIPT", "MATERIAL_REQUEST", "STOCK_TRANSFER", "FG_RECEIPT", "DELIVERY_NOTE"] as const;
const uuid = z.string().uuid();
const decimal = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,4})?$/, "Qty harus berupa angka positif (maks. 4 desimal)")
  .transform((v) => v.replace(",", "."))
  .refine((v) => Number(v) > 0, "Qty harus lebih dari 0");

const SaveSchema = z.object({
  docType: z.enum(DOC_TYPES),
  docId: uuid.nullable(),
  header: z.record(z.string(), z.string()),
  lines: z
    .array(
      z.object({
        item_id: z.string(),
        qty: z.string(),
        location_id: z.string().optional(),
        to_location_id: z.string().optional(),
      }),
    )
    .max(200),
  submit: z.boolean(),
});

export interface WarningView {
  code: string;
  message: string;
}

/** Terjemahkan peringatan mentah dari database menjadi kalimat yang bisa dibaca user. */
async function describeWarnings(supabase: Supabase, raw: unknown): Promise<WarningView[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const itemIds = [...new Set(raw.map((w) => w.item_id).filter(Boolean))];
  const locIds = [...new Set(raw.map((w) => w.location_id).filter(Boolean))];
  const [items, locs] = await Promise.all([
    itemIds.length ? supabase.from("item").select("id, code").in("id", itemIds) : { data: [] },
    locIds.length ? supabase.from("location").select("id, code").in("id", locIds) : { data: [] },
  ]);
  const itemCode = new Map((items.data ?? []).map((i) => [i.id, i.code]));
  const locCode = new Map((locs.data ?? []).map((l) => [l.id, l.code]));
  return raw.map((w) => {
    if (w.code === "STOCK_LOW") {
      const where = w.location_id ? ` di ${locCode.get(w.location_id) ?? "penempatan"}` : " (total gudang)";
      return {
        code: w.code,
        message: `Stok ${itemCode.get(w.item_id) ?? "item"}${where} saat ini ${fmtQty(w.available)}, dibutuhkan ${fmtQty(w.required)}. Dokumen tetap diajukan, tetapi validasi akan diblokir bila stok belum cukup.`,
      };
    }
    if (w.code === "OVER_TARGET") {
      return {
        code: w.code,
        message: `Total penerimaan (${fmtQty(Number(w.received) + Number(w.incoming))}) melebihi target PO produksi (${fmtQty(w.target)}).`,
      };
    }
    return { code: String(w.code), message: String(w.code) };
  });
}

async function explain(supabase: Supabase, err: DomainError): Promise<DomainError> {
  if (err.code === "LOCATION_UNDER_COUNT" && err.detail) {
    const d = err.detail as { location_id?: string };
    const { data } = d.location_id ? await supabase.from("location").select("code").eq("id", d.location_id).maybeSingle() : { data: null };
    if (data) {
      return { ...err, message: `Penempatan ${data.code} sedang dihitung (stock opname). Transaksi pada penempatan ini tertahan sampai opname selesai atau dibatalkan.` };
    }
  }
  if (err.code === "INSUFFICIENT_STOCK" && err.detail) {
    const d = err.detail as { item_id?: string; location_id?: string; available?: number; required?: number };
    const [item, loc] = await Promise.all([
      d.item_id ? supabase.from("item").select("code").eq("id", d.item_id).maybeSingle() : { data: null },
      d.location_id ? supabase.from("location").select("code").eq("id", d.location_id).maybeSingle() : { data: null },
    ]);
    return {
      ...err,
      message: `Stok ${item.data?.code ?? "item"} di ${loc.data?.code ?? "penempatan"} tidak cukup: tersedia ${fmtQty(d.available)}, dibutuhkan ${fmtQty(d.required)}.`,
    };
  }
  return err;
}

const refresh = () => revalidatePath("/", "layout");

export async function saveDraftAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; status?: string; docNo?: string; warnings: WarningView[] }>> {
  const parsed = SaveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Input tidak valid." } };
  }
  const { docType, docId, header, submit } = parsed.data;

  // buang baris kosong; validasi qty baris yang terisi
  const lines: Array<Record<string, string>> = [];
  for (const [i, l] of parsed.data.lines.entries()) {
    if (!l.item_id && !l.qty.trim() && !l.location_id && !l.to_location_id) continue;
    if (!l.item_id) return { ok: false, error: { code: "INVALID_INPUT", message: `Baris ${i + 1}: item belum dipilih.` } };
    const q = decimal.safeParse(l.qty);
    if (!q.success) return { ok: false, error: { code: "INVALID_INPUT", message: `Baris ${i + 1}: ${q.error.issues[0].message}` } };
    lines.push({ item_id: l.item_id, qty: q.data, location_id: l.location_id ?? "", to_location_id: l.to_location_id ?? "" });
  }
  const h = { ...header };
  if (h.target_qty) {
    const q = decimal.safeParse(h.target_qty);
    if (!q.success) return { ok: false, error: { code: "INVALID_INPUT", message: `Qty target: ${q.error.issues[0].message}` } };
    h.target_qty = q.data;
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_draft", {
    p_doc_type: docType,
    p_doc_id: docId,
    p_payload: { header: h, lines },
  });
  if (error) return { ok: false, error: await explain(supabase, mapDbError(error)) };
  if (!id) return { ok: false, error: { code: "UNKNOWN", message: "Draft gagal disimpan." } };

  if (!submit) {
    refresh();
    return { ok: true, data: { id: id as string, warnings: [] } };
  }
  const { data: sub, error: subErr } = await supabase.rpc("submit_document", { p_doc_id: id });
  refresh();
  if (subErr) return { ok: false, error: await explain(supabase, mapDbError(subErr)), savedId: id as string };
  const r = sub as { status: string; doc_no: string; warnings: unknown };
  return {
    ok: true,
    data: { id: id as string, status: r.status, docNo: r.doc_no, warnings: await describeWarnings(supabase, r.warnings) },
  };
}

export async function submitAction(
  docId: string,
): Promise<ActionResult<{ status: string; docNo: string; warnings: WarningView[] }>> {
  if (!uuid.safeParse(docId).success) return { ok: false, error: { code: "INVALID_INPUT", message: "ID dokumen tidak valid." } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_document", { p_doc_id: docId });
  refresh();
  if (error) return { ok: false, error: await explain(supabase, mapDbError(error)) };
  const r = data as { status: string; doc_no: string; warnings: unknown };
  return { ok: true, data: { status: r.status, docNo: r.doc_no, warnings: await describeWarnings(supabase, r.warnings) } };
}

const DecideSchema = z.object({
  docId: uuid,
  decision: z.enum(["APPROVE", "RETURN", "REJECT"]),
  reason: z.string().max(1000).optional(),
  allocations: z
    .array(z.object({ line_id: uuid, location_id: uuid, qty: z.string() }))
    .nullable()
    .optional(),
});

export async function decideAction(raw: unknown): Promise<ActionResult<{ status: string }>> {
  const parsed = DecideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_INPUT", message: "Input keputusan tidak valid." } };
  const { docId, decision, reason, allocations } = parsed.data;

  let alloc: Array<{ line_id: string; location_id: string; qty: string }> | null = null;
  if (allocations && allocations.length) {
    alloc = [];
    for (const a of allocations) {
      const q = decimal.safeParse(a.qty);
      if (!q.success) return { ok: false, error: { code: "INVALID_INPUT", message: `Alokasi: ${q.error.issues[0].message}` } };
      alloc.push({ ...a, qty: q.data });
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_document", {
    p_doc_id: docId,
    p_decision: decision,
    p_reason: reason?.trim() || null,
    p_allocations: alloc,
  });
  refresh();
  if (error) return { ok: false, error: await explain(supabase, mapDbError(error)) };
  return { ok: true, data: { status: (data as { status: string }).status } };
}

export async function reverseAction(docId: string, reason: string): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(docId).success) return { ok: false, error: { code: "INVALID_INPUT", message: "ID dokumen tidak valid." } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_reversal", { p_doc_id: docId, p_reason: reason });
  refresh();
  if (error) return { ok: false, error: mapDbError(error) };
  return { ok: true, data: { id: data as string } };
}

export async function deleteDraftAction(docId: string): Promise<ActionResult> {
  if (!uuid.safeParse(docId).success) return { ok: false, error: { code: "INVALID_INPUT", message: "ID dokumen tidak valid." } };
  const supabase = await createClient();
  // catat berkas lampiran dulu: barisnya ikut terhapus bersama draft, berkasnya harus dibersihkan dari Storage
  const { data: files } = await supabase.from("document_attachment").select("storage_path").eq("document_id", docId);
  const { error } = await supabase.rpc("delete_draft", { p_doc_id: docId });
  refresh();
  if (error) return { ok: false, error: mapDbError(error) };
  if (files?.length) {
    try {
      await createAdminClient().storage.from("attachments").remove(files.map((f) => f.storage_path));
    } catch {
      /* berkas yatim tidak membahayakan data; bucket privat */
    }
  }
  return { ok: true, data: {} };
}

export async function markNotificationsReadAction(ids?: string[]): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null });
  refresh();
}
