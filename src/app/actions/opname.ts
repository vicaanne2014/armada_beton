"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mapDbError, type DomainError } from "@/lib/domain/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./documents";

const uuid = z.string().uuid();
const bad = (message: string): ActionResult<never> => ({ ok: false, error: { code: "INVALID_INPUT", message } });
const refresh = () => revalidatePath("/", "layout");

const OpenSchema = z.object({
  warehouseId: uuid,
  locationIds: z.array(uuid).min(1, "Pilih minimal satu penempatan yang akan dihitung."),
  includeChildren: z.boolean(),
  note: z.string().max(500).optional(),
});

export async function openOpnameAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = OpenSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0].message);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_opname", {
    p_warehouse_id: v.warehouseId,
    p_location_ids: v.locationIds,
    p_include_children: v.includeChildren,
    p_note: v.note?.trim() || null,
  });
  refresh();
  if (error) return { ok: false, error: await explainLock(supabase, mapDbError(error)) };
  return { ok: true, data: { id: data as string } };
}

const countValue = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,4})?$/, "Hitungan harus berupa angka ≥ 0 (maks. 4 desimal)")
  .transform((v) => v.replace(",", "."));

const CountSchema = z.object({
  docId: uuid,
  note: z.string().max(500).optional(),
  submit: z.boolean(),
  lines: z
    .array(
      z.object({
        line_id: uuid.optional(),
        item_id: uuid.optional(),
        location_id: uuid.optional(),
        counted: z.string().optional(),
        note: z.string().max(300).optional(),
        remove: z.boolean().optional(),
      }),
    )
    .max(2000),
});

export async function saveOpnameCountAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; status?: string; docNo?: string }>> {
  const parsed = CountSchema.safeParse(raw);
  if (!parsed.success) return bad("Input hitungan tidak valid.");
  const { docId, note, submit } = parsed.data;

  const lines: Array<Record<string, unknown>> = [];
  for (const [i, l] of parsed.data.lines.entries()) {
    if (l.remove) {
      if (l.line_id) lines.push({ line_id: l.line_id, remove: true });
      continue;
    }
    let counted: string | null = null;
    if (l.counted && l.counted.trim() !== "") {
      const c = countValue.safeParse(l.counted);
      if (!c.success) return bad(`Baris ${i + 1}: ${c.error.issues[0].message}`);
      counted = c.data;
    }
    if (l.line_id) {
      lines.push({ line_id: l.line_id, counted_qty: counted, note: l.note ?? "" });
    } else if (l.item_id && l.location_id) {
      lines.push({ item_id: l.item_id, location_id: l.location_id, counted_qty: counted, note: l.note ?? "" });
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_opname_count", { p_doc_id: docId, p_lines: lines, p_note: note ?? null });
  refresh();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!submit) return { ok: true, data: { id: docId } };

  const { data, error: subErr } = await supabase.rpc("submit_document", { p_doc_id: docId });
  refresh();
  if (subErr) return { ok: false, error: mapDbError(subErr), savedId: docId };
  const r = data as { status: string; doc_no: string };
  return { ok: true, data: { id: docId, status: r.status, docNo: r.doc_no } };
}

export async function cancelOpnameAction(docId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(docId).success) return bad("ID dokumen tidak valid.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_opname", { p_doc_id: docId, p_reason: reason });
  refresh();
  if (error) return { ok: false, error: mapDbError(error) };
  return { ok: true, data: {} };
}

async function explainLock(supabase: Awaited<ReturnType<typeof createClient>>, err: DomainError): Promise<DomainError> {
  if (err.code !== "LOCATION_UNDER_COUNT") return err;
  // beri tahu penempatan mana yang sudah dihitung sesi lain
  const { data } = await supabase.from("opname_lock").select("location:location(code)");
  const codes = (data ?? [])
    .map((r) => (Array.isArray(r.location) ? r.location[0] : (r.location as { code: string } | null))?.code)
    .filter(Boolean);
  return codes.length
    ? { ...err, message: `${err.message} Penempatan yang sedang dihitung: ${codes.join(", ")}.` }
    : err;
}

export async function removeAttachmentAction(attachmentId: string): Promise<ActionResult> {
  if (!uuid.safeParse(attachmentId).success) return bad("ID lampiran tidak valid.");
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_attachment", { p_id: attachmentId });
  refresh();
  if (error) return { ok: false, error: mapDbError(error) };
  try {
    await createAdminClient().storage.from("attachments").remove([path as string]);
  } catch {
    /* baris sudah terhapus; berkas yatim tidak bisa diakses (bucket privat) */
  }
  return { ok: true, data: {} };
}
