import "server-only";
import { docTypeByType } from "@/lib/domain/doc-types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const first = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DocumentFull {
  doc: any;
  ext: any;
  steps: any[];
  original: { id: string; doc_no: string | null; doc_type: string } | null;
  liveReversal: { id: string; doc_no: string | null; status: string } | null;
  po: { id: string; po_number: string } | null;
  /** hanya untuk STOCK_OPNAME */
  opnameLines: any[];
  /** hanya untuk MATERIAL_RECEIPT */
  attachments: any[];
}

/** Dokumen lengkap beserta baris, ekstensi, riwayat approval, dan relasi pembalik. RLS berlaku. */
export async function getDocumentFull(supabase: Supabase, id: string): Promise<DocumentFull | null> {
  const { data: doc } = await supabase
    .from("document")
    .select(
      `id, doc_type, doc_no, status, warehouse_id, department_id, created_by, created_at, submitted_at,
       validated_at, cycle, reverses_document_id, note,
       creator:app_user!created_by(full_name),
       validator:app_user!validated_by(full_name),
       warehouse:warehouse(code, name, category),
       department:department(name),
       lines:document_line(
         id, line_no, item_id, qty, location_id, to_location_id,
         item:item(code, name, uom:uom(code)),
         loc:location!location_id(code, name),
         to_loc:location!to_location_id(code, name),
         allocs:document_line_alloc(id, qty, location_id, loc:location(code, name))
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!doc) return null;
  doc.lines = [...(doc.lines ?? [])].sort((a: any, b: any) => a.line_no - b.line_no);

  const def = docTypeByType(doc.doc_type);
  const [extRes, stepsRes, origRes, revRes] = await Promise.all([
    def?.ext
      ? supabase.from(def.ext).select(def.extColumns).eq("document_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("approval_step")
      .select("id, cycle, step_order, step_role, decision, reason, decided_at, approver:app_user!approver_id(full_name)")
      .eq("document_id", id)
      .order("cycle")
      .order("step_order"),
    doc.reverses_document_id
      ? supabase.from("document").select("id, doc_no, doc_type").eq("id", doc.reverses_document_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("document")
      .select("id, doc_no, status")
      .eq("reverses_document_id", id)
      .neq("status", "DITOLAK")
      .maybeSingle(),
  ]);

  const ext: any = extRes.data;
  let po: DocumentFull["po"] = null;
  const poId = ext?.production_po_id as string | undefined;
  if (poId) {
    const { data } = await supabase.from("production_po").select("id, po_number").eq("id", poId).maybeSingle();
    po = data;
  }
  let opnameLines: any[] = [];
  if (doc.doc_type === "STOCK_OPNAME") {
    const { data } = await supabase
      .from("opname_line")
      .select("id, line_no, item_id, location_id, system_qty, counted_qty, note, item:item(code, name, uom:uom(code)), loc:location(code, name)")
      .eq("document_id", id)
      .order("line_no");
    opnameLines = data ?? [];
  }
  let attachments: any[] = [];
  if (doc.doc_type === "MATERIAL_RECEIPT") {
    const { data } = await supabase
      .from("document_attachment")
      .select("id, file_name, content_type, size_bytes, uploaded_at")
      .eq("document_id", id)
      .order("uploaded_at");
    attachments = data ?? [];
  }
  return {
    doc,
    ext,
    steps: stepsRes.data ?? [],
    original: origRes.data as DocumentFull["original"],
    liveReversal: revRes.data as DocumentFull["liveReversal"],
    po,
    opnameLines,
    attachments,
  };
}
