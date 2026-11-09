import { notFound, redirect } from "next/navigation";
import { AttachmentsCard } from "@/components/attachments-card";
import { DocForm, type LineState } from "@/components/doc-form";
import { OpnameCountForm, type CountLine } from "@/components/opname-count-form";
import { PageHeader } from "@/components/ui";
import { docTypeBySlug } from "@/lib/domain/doc-types";
import { first, getDocumentFull } from "@/lib/documents";
import { buildLocationLabels, getLookups, getMyWarehouseIds } from "@/lib/lookups";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function EditDocPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const def = docTypeBySlug(type);
  if (!def) notFound();
  const s = await requireSession();
  const supabase = await createClient();
  const full = await getDocumentFull(supabase, id);
  if (!full || full.doc.doc_type !== def.type) notFound();
  const { doc, ext } = full;

  const editable = doc.created_by === s.userId && ["DRAFT", "DIKEMBALIKAN"].includes(doc.status) && !doc.reverses_document_id;
  if (!editable) redirect(`/docs/${def.slug}/${id}`);

  const returned = [...full.steps].reverse().find((st) => st.decision === "RETURNED");

  // ---- stock opname: layar hitungan ----
  if (def.type === "STOCK_OPNAME") {
    const [{ data: lockRows }, { data: locs }, { data: items }] = await Promise.all([
      supabase.from("opname_lock").select("location_id").eq("document_id", id),
      supabase.from("location").select("id, parent_id, code, name").eq("warehouse_id", doc.warehouse_id),
      supabase
        .from("item")
        .select("id, code, name, uom:uom(code)")
        .eq("is_active", true)
        .eq("item_type", (first(doc.warehouse) as { category: string }).category)
        .order("code"),
    ]);
    const labels = buildLocationLabels(locs ?? []);
    const lines: CountLine[] = full.opnameLines.map((l) => {
      const item = first(l.item) as { code: string; name: string; uom: { code: string } | { code: string }[] | null };
      return {
        id: l.id,
        itemId: l.item_id,
        itemLabel: `${item.code} — ${item.name}`,
        uom: first(item.uom)?.code ?? "",
        locationId: l.location_id,
        locationLabel: labels.get(l.location_id) ?? "",
        system: Number(l.system_qty),
        counted: l.counted_qty === null ? "" : String(Number(l.counted_qty)),
        note: l.note ?? "",
      };
    });
    return (
      <>
        <PageHeader title="Hitung Stock Opname" subtitle={`${doc.doc_no ?? "Draft"} · ${(first(doc.warehouse) as { code: string; name: string }).name}`} />
        <OpnameCountForm
          docId={doc.id}
          lines={lines}
          scope={(lockRows ?? []).map((r) => ({ id: r.location_id, label: labels.get(r.location_id) ?? "" }))}
          items={(items ?? []).map((i) => ({
            id: i.id,
            code: i.code,
            name: i.name,
            uom: first(i.uom as unknown as { code: string } | null)?.code ?? "",
          }))}
          note={doc.note ?? ""}
          returnReason={doc.status === "DIKEMBALIKAN" ? returned?.reason : null}
        />
      </>
    );
  }

  // ---- dokumen generik ----
  const header: Record<string, string> = { note: doc.note ?? "" };
  if (ext) {
    for (const f of def.headerFields) {
      if (f.name === "po_number" && ext.po_reference) header.po_number = ext.po_reference.po_number ?? "";
      else if (f.name === "po_date" && ext.po_reference) header.po_date = ext.po_reference.po_date ?? "";
      else if (ext[f.name] !== undefined && ext[f.name] !== null) header[f.name] = String(ext[f.name]);
    }
  }
  const lines: LineState[] = doc.lines.map((l: Record<string, string | number | null>) => ({
    item_id: String(l.item_id),
    qty: String(Number(l.qty)),
    location_id: l.location_id ? String(l.location_id) : "",
    to_location_id: l.to_location_id ? String(l.to_location_id) : "",
  }));

  const [lookups, mine] = await Promise.all([
    getLookups(supabase),
    def.requiresMembership ? getMyWarehouseIds(supabase, s.userId) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={`Ubah ${def.label}`} subtitle={doc.doc_no ?? "Draft"} />
      <div className="space-y-6">
        <DocForm
          def={{
            type: def.type as Exclude<typeof def.type, "STOCK_OPNAME">,
            slug: def.slug,
            label: def.label,
            warehouseCategory: def.warehouseCategory,
            headerFields: def.headerFields,
            lines: def.lines,
          }}
          lookups={lookups}
          allowedWarehouseIds={mine}
          initial={{
            id: doc.id,
            warehouseId: doc.warehouse_id,
            header,
            lines,
            docNo: doc.doc_no,
            status: doc.status,
            returnReason: doc.status === "DIKEMBALIKAN" ? returned?.reason : null,
          }}
        />
        {def.type === "MATERIAL_RECEIPT" && <AttachmentsCard docId={doc.id} items={full.attachments} editable />}
      </div>
    </>
  );
}
