import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { docHref } from "@/lib/domain/doc-types";
import { first } from "@/lib/documents";
import { fmtQty, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();
  const supabase = await createClient();

  const { data: po } = await supabase.from("v_production_po_progress").select("*").eq("id", id).maybeSingle();
  if (!po) notFound();

  const [{ data: taken }, { data: reqs }, { data: fgs }] = await Promise.all([
    supabase.from("v_po_material_taken").select("item_id, item_code, item_name, qty").eq("po_id", id),
    supabase.from("material_request").select("document:document(id, doc_no, status, reverses_document_id)").eq("production_po_id", id),
    supabase.from("fg_receipt").select("document:document(id, doc_no, status, reverses_document_id)").eq("production_po_id", id),
  ]);
  const docs = (rows: typeof reqs, type: string) =>
    (rows ?? [])
      .map((r) =>
        first(
          r.document as unknown as { id: string; doc_no: string | null; status: string; reverses_document_id: string | null } | null,
        ),
      )
      .filter(Boolean)
      .map((d) => ({ ...d!, type }));
  const allDocs = [...docs(reqs, "MATERIAL_REQUEST"), ...docs(fgs, "FG_RECEIPT")];

  const over = Number(po.remaining_qty) < 0;
  return (
    <>
      <PageHeader title={`PO ${po.po_number}`} subtitle={`${po.finished_item_code} — ${po.finished_item_name}`} />
      <div className="space-y-6">
        {over && <Alert tone="warn">Total barang jadi yang diterima melebihi target PO.</Alert>}
        <Card>
          <div className="grid gap-6 sm:grid-cols-4">
            <Stat label="Target" value={fmtQty(po.target_qty)} />
            <Stat label="Diterima" value={fmtQty(po.received_qty)} />
            <Stat label="Sisa" value={fmtQty(po.remaining_qty)} />
            <Stat label="Status" value={<Badge tone={po.status === "ACTIVE" ? "green" : "amber"}>{po.status === "ACTIVE" ? "Aktif" : "Menunggu"}</Badge>} />
          </div>
        </Card>
        <Card title="Material diambil (permintaan tervalidasi)">
          {!taken?.length ? (
            <Empty>Belum ada material yang diambil.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Material</Th><Th className="text-right">Qty</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {taken.map((t) => (
                  <tr key={t.item_id}><Td>{t.item_code} — {t.item_name}</Td><Td className="text-right tabular-nums">{fmtQty(t.qty)}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Dokumen terkait">
          {!allDocs.length ? (
            <Empty>Tidak ada dokumen yang bisa Anda lihat.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Nomor</Th><Th>Jenis</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {allDocs.map((d) => (
                  <tr key={d.id}>
                    <Td><Link href={docHref(d.type, d.id)} className="text-blue-700 hover:underline">{d.doc_no ?? "(draft)"}</Link></Td>
                    <Td>{d.type === "MATERIAL_REQUEST" ? "Permintaan Material" : "Penerimaan Barang Jadi"}{d.reverses_document_id ? " (pembalik)" : ""}</Td>
                    <Td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
