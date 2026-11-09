import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { docTypeBySlug } from "@/lib/domain/doc-types";
import { first } from "@/lib/documents";
import { fmtDateTime, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["DRAFT", "MENUNGGU_APPROVAL", "MENUNGGU_VALIDASI", "DIKEMBALIKAN", "DITOLAK", "TERVALIDASI"];

export default async function DocListPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { type } = await params;
  const { status } = await searchParams;
  const def = docTypeBySlug(type);
  if (!def) notFound();
  const s = await requireSession();
  const supabase = await createClient();

  let q = supabase
    .from("document")
    .select(
      `id, doc_no, status, created_at, reverses_document_id,
       creator:app_user!created_by(full_name), warehouse:warehouse(code),
       material_receipt(sj_number), material_request(po_number),
       fg_receipt(po:production_po(po_number)), delivery_note(sj_number)`,
    )
    .eq("doc_type", def.type)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && STATUSES.includes(status)) q = q.eq("status", status);
  const { data: docs } = await q;

  const refOf = (d: Record<string, unknown>) => {
    const mr = first(d.material_receipt as { sj_number: string } | null);
    const rq = first(d.material_request as { po_number: string } | null);
    const fr = first(d.fg_receipt as { po: { po_number: string } | { po_number: string }[] | null } | null);
    const dn = first(d.delivery_note as { sj_number: string | null } | null);
    return mr?.sj_number ?? rq?.po_number ?? first(fr?.po)?.po_number ?? dn?.sj_number ?? "";
  };
  const refLabel =
    def.type === "MATERIAL_RECEIPT" ? "No. SJ Masuk" : def.type === "MATERIAL_REQUEST" ? "PO Produksi" : def.type === "FG_RECEIPT" ? "PO Produksi" : def.type === "DELIVERY_NOTE" ? "No. Surat Jalan" : "";

  return (
    <>
      <PageHeader
        title={def.label}
        actions={s.can(def.createPerm) ? <LinkButton href={`/docs/${def.slug}/new`}>+ Buat Baru</LinkButton> : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={`/docs/${def.slug}`}
          className={`rounded-full px-3 py-1 text-sm ${!status ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
        >
          Semua
        </Link>
        {STATUSES.map((st) => (
          <Link
            key={st}
            href={`/docs/${def.slug}?status=${st}`}
            className={`rounded-full px-3 py-1 text-sm ${status === st ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {STATUS_LABEL[st]}
          </Link>
        ))}
      </div>
      <Card>
        {!docs?.length ? (
          <Empty>Belum ada dokumen.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nomor</Th>
                {refLabel && <Th>{refLabel}</Th>}
                <Th>Gudang</Th>
                <Th>Status</Th>
                <Th>Dibuat oleh</Th>
                <Th>Dibuat</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/docs/${def.slug}/${d.id}`} className="font-medium text-blue-700 hover:underline">
                      {d.doc_no ?? "(draft)"}
                    </Link>
                    {d.reverses_document_id && <span className="ml-2 text-xs text-slate-500">pembalik</span>}
                  </Td>
                  {refLabel && <Td>{refOf(d)}</Td>}
                  <Td>{(first(d.warehouse as { code: string }[] | { code: string } | null))?.code}</Td>
                  <Td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></Td>
                  <Td>{(first(d.creator as { full_name: string }[] | { full_name: string } | null))?.full_name}</Td>
                  <Td>{fmtDateTime(d.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
