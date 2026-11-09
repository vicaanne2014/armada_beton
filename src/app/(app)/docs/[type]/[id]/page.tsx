import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachmentsCard } from "@/components/attachments-card";
import { DecisionPanel, DocActions, type AllocLine } from "@/components/doc-actions";
import { Alert, Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { docTypeBySlug, docHref } from "@/lib/domain/doc-types";
import { getDocumentFull, first } from "@/lib/documents";
import { buildLocationLabels } from "@/lib/lookups";
import {
  DECISION_LABEL,
  fmtDate,
  fmtDateTime,
  fmtQty,
  STATUS_LABEL,
  STATUS_TONE,
  STEP_LABEL,
} from "@/lib/format";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type One<T> = T | T[] | null;
interface OpnameRow {
  id: string;
  system_qty: number;
  counted_qty: number | null;
  note: string | null;
  item: One<{ code: string; name: string; uom: One<{ code: string }> }>;
  loc: One<{ code: string; name: string }>;
}

const Meta = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-900">{children || "-"}</dd>
  </div>
);

export default async function DocDetailPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const def = docTypeBySlug(type);
  if (!def) notFound();
  const s = await requireSession();
  const supabase = await createClient();
  const full = await getDocumentFull(supabase, id);
  if (!full || full.doc.doc_type !== def.type) notFound();
  const { doc, ext, steps, original, liveReversal, po, opnameLines, attachments } = full;

  const isReversal = Boolean(doc.reverses_document_id);
  const isCreator = doc.created_by === s.userId;
  const warehouse = first(doc.warehouse) as { code: string; name: string } | null;

  // apakah giliran saya memutuskan?
  const { data: inboxRow } = s.can("doc.decide")
    ? await supabase.from("v_inbox").select("step_role").eq("id", id).maybeSingle()
    : { data: null };
  const pendingRole = inboxRow?.step_role as "KEPALA_DEPT" | "KEPALA_GUDANG" | undefined;

  // data alokasi untuk validasi permintaan material
  const needsAllocation = pendingRole === "KEPALA_GUDANG" && doc.doc_type === "MATERIAL_REQUEST" && !isReversal;
  let allocLines: AllocLine[] = [];
  if (needsAllocation) {
    const itemIds = doc.lines.map((l: { item_id: string }) => l.item_id);
    const [{ data: stock }, { data: locs }] = await Promise.all([
      supabase.from("v_stock").select("item_id, location_id, qty").eq("warehouse_id", doc.warehouse_id).in("item_id", itemIds).gt("qty", 0),
      supabase.from("location").select("id, parent_id, code, name").eq("warehouse_id", doc.warehouse_id),
    ]);
    const labels = buildLocationLabels(locs ?? []);
    allocLines = doc.lines.map((l: Record<string, unknown>) => {
      const item = l.item as { code: string; name: string; uom: { code: string } | { code: string }[] | null };
      return {
        id: l.id as string,
        itemCode: item.code,
        itemName: item.name,
        qty: Number(l.qty),
        uom: first(item.uom)?.code ?? "",
        stock: (stock ?? [])
          .filter((r) => r.item_id === l.item_id)
          .map((r) => ({ location_id: r.location_id, label: labels.get(r.location_id) ?? "", qty: Number(r.qty) })),
      };
    });
  }

  const sjNumber = doc.doc_type === "DELIVERY_NOTE" ? (ext?.sj_number as string | null) : null;
  const canPdf = doc.doc_type === "DELIVERY_NOTE" && doc.status === "TERVALIDASI" && !isReversal && sjNumber;

  const maxCycle = steps.reduce((m: number, st: { cycle: number }) => Math.max(m, st.cycle), 0);
  const cycles = Array.from({ length: maxCycle }, (_, i) => i + 1);

  return (
    <>
      <PageHeader
        title={doc.doc_no ?? "Draft"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {def.label}
            <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
            {isReversal && <Badge tone="orange">Transaksi pembalik</Badge>}
          </span>
        }
        actions={
          canPdf ? (
            <LinkButton href={`/api/pdf/delivery-notes/${doc.id}`} target="_blank" variant="secondary">
              Cetak Surat Jalan (PDF)
            </LinkButton>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {isReversal && original && (
          <Alert tone="warn">
            Dokumen ini membalik{" "}
            <Link className="font-medium underline" href={docHref(original.doc_type, original.id)}>
              {original.doc_no}
            </Link>
            . Alasan: {doc.note}
          </Alert>
        )}
        {liveReversal && (
          <Alert tone="info">
            Dokumen ini sudah dibalik oleh{" "}
            <Link className="font-medium underline" href={docHref(doc.doc_type, liveReversal.id)}>
              {liveReversal.doc_no ?? "draft pembalik"}
            </Link>{" "}
            ({STATUS_LABEL[liveReversal.status]}).
          </Alert>
        )}

        <Card title="Informasi">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Gudang">{warehouse ? `${warehouse.code} — ${warehouse.name}` : ""}</Meta>
            <Meta label="Dibuat oleh">{(first(doc.creator) as { full_name: string } | null)?.full_name}</Meta>
            <Meta label="Departemen">{(first(doc.department) as { name: string } | null)?.name}</Meta>
            <Meta label="Dibuat">{fmtDateTime(doc.created_at)}</Meta>
            <Meta label="Diajukan">{fmtDateTime(doc.submitted_at)}</Meta>
            <Meta label="Divalidasi">
              {doc.validated_at
                ? `${fmtDateTime(doc.validated_at)} oleh ${(first(doc.validator) as { full_name: string } | null)?.full_name ?? ""}`
                : ""}
            </Meta>
            {doc.doc_type === "MATERIAL_RECEIPT" && ext && (
              <>
                <Meta label="No. Surat Jalan Masuk">{ext.sj_number}</Meta>
                <Meta label="Tanggal Terima">{fmtDate(ext.receipt_date)}</Meta>
                <Meta label="No. PO Referensi">{ext.po_reference?.po_number}</Meta>
              </>
            )}
            {doc.doc_type === "MATERIAL_REQUEST" && ext && (
              <>
                <Meta label="No. PO Produksi">{ext.po_number}</Meta>
                <Meta label="Qty Target">{fmtQty(ext.target_qty)}</Meta>
              </>
            )}
            {doc.doc_type === "FG_RECEIPT" && po && (
              <Meta label="PO Produksi">
                <Link href={`/po/${po.id}`} className="text-blue-700 hover:underline">{po.po_number}</Link>
              </Meta>
            )}
            {doc.doc_type === "DELIVERY_NOTE" && ext && (
              <>
                <Meta label="No. Surat Jalan">{sjNumber ?? "Terbit setelah validasi"}</Meta>
                <Meta label="Tanggal Kirim">{fmtDate(ext.delivery_date)}</Meta>
                <Meta label="Ref. PO Customer">{ext.customer_po_ref}</Meta>
              </>
            )}
            {doc.note && !isReversal && <Meta label="Catatan">{doc.note}</Meta>}
          </dl>
          {doc.doc_type === "MATERIAL_REQUEST" && po && (
            <p className="mt-4 text-sm">
              <Link href={`/po/${po.id}`} className="text-blue-700 hover:underline">Lihat pelacakan PO {po.po_number}</Link>
            </p>
          )}
        </Card>

        {def.type === "STOCK_OPNAME" ? (
          <Card
            title="Hasil Hitungan"
            action={
              <span className="text-sm text-slate-600">
                {opnameLines.length} baris · {opnameLines.filter((l: OpnameRow) => l.counted_qty !== null && Number(l.counted_qty) !== Number(l.system_qty)).length} selisih
              </span>
            }
          >
            {!opnameLines.length ? (
              <p className="text-sm text-slate-500">Tidak ada baris.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Penempatan</Th><Th>Item</Th>
                    <Th className="text-right">Stok sistem</Th><Th className="text-right">Hitungan fisik</Th>
                    <Th className="text-right">Selisih</Th><Th>Catatan</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {opnameLines.map((l: OpnameRow) => {
                    const item = first(l.item);
                    const uom = first(item?.uom)?.code ?? "";
                    const diff = l.counted_qty === null ? null : Number(l.counted_qty) - Number(l.system_qty);
                    return (
                      <tr key={l.id}>
                        <Td>{first(l.loc)?.code}</Td>
                        <Td>{item?.code} — {item?.name}</Td>
                        <Td className="text-right tabular-nums">{fmtQty(l.system_qty)} {uom}</Td>
                        <Td className="text-right tabular-nums">{l.counted_qty === null ? <span className="text-amber-700">belum</span> : `${fmtQty(l.counted_qty)} ${uom}`}</Td>
                        <Td className={`text-right tabular-nums ${diff === null || diff === 0 ? "text-slate-500" : diff < 0 ? "text-red-700" : "text-green-700"}`}>
                          {diff === null ? "-" : `${diff > 0 ? "+" : ""}${fmtQty(diff)}`}
                        </Td>
                        <Td className="text-slate-600">{l.note}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {!isReversal && ["DRAFT", "DIKEMBALIKAN", "MENUNGGU_APPROVAL", "MENUNGGU_VALIDASI"].includes(doc.status) && (
              <p className="mt-3 text-xs text-slate-500">
                Penempatan pada sesi ini terkunci: transaksi lain di sana tertahan sampai opname selesai.
                Selisih baru diposting ke stok saat divalidasi Kepala Gudang.
              </p>
            )}
          </Card>
        ) : (
        <Card title="Daftar Item">
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                {def.type === "MATERIAL_REQUEST" ? (
                  <Th>Diambil dari</Th>
                ) : (
                  <>
                    {def.lines.location && <Th>{def.lines.locationLabel}</Th>}
                    {def.lines.toLocation && <Th>Ke penempatan</Th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doc.lines.map((l: Record<string, unknown>) => {
                const item = l.item as { code: string; name: string; uom: { code: string } | { code: string }[] | null };
                const allocs = (l.allocs ?? []) as Array<{ id: string; qty: number; loc: { code: string } | { code: string }[] | null }>;
                return (
                  <tr key={l.id as string}>
                    <Td className="text-slate-500">{l.line_no as number}</Td>
                    <Td>{item.code} — {item.name}</Td>
                    <Td className="text-right tabular-nums">{fmtQty(l.qty as number)} {first(item.uom)?.code}</Td>
                    {def.type === "MATERIAL_REQUEST" ? (
                      <Td>
                        {allocs.length
                          ? allocs.map((a) => `${first(a.loc)?.code} (${fmtQty(a.qty)})`).join(", ")
                          : <span className="text-slate-400">Ditentukan Kepala Gudang saat validasi</span>}
                      </Td>
                    ) : (
                      <>
                        {def.lines.location && <Td>{(first(l.loc as { code: string; name: string } | null))?.code}</Td>}
                        {def.lines.toLocation && <Td>{(first(l.to_loc as { code: string; name: string } | null))?.code}</Td>}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        )}

        {doc.doc_type === "MATERIAL_RECEIPT" && !isReversal && (
          <AttachmentsCard
            docId={doc.id}
            items={attachments}
            editable={isCreator && ["DRAFT", "DIKEMBALIKAN"].includes(doc.status)}
          />
        )}

        {pendingRole && (
          <DecisionPanel
            docId={doc.id}
            stepRole={pendingRole}
            needsAllocation={needsAllocation}
            allocLines={allocLines}
          />
        )}

        <DocActions
          docId={doc.id}
          slug={def.slug}
          editLabel={doc.doc_type === "STOCK_OPNAME" ? "Lanjut Hitung" : "Ubah"}
          canCancelOpname={doc.doc_type === "STOCK_OPNAME" && isCreator && !isReversal && ["DRAFT", "DIKEMBALIKAN"].includes(doc.status)}
          canSubmit={isCreator && doc.status === "DRAFT"}
          canEdit={isCreator && ["DRAFT", "DIKEMBALIKAN"].includes(doc.status) && !isReversal}
          canDelete={isCreator && doc.status === "DRAFT" && doc.cycle === 0}
          canReverse={doc.status === "TERVALIDASI" && !isReversal && !liveReversal && s.can("doc.create.reversal")}
        />

        <Card title="Riwayat Persetujuan">
          {steps.length === 0 ? (
            <p className="text-sm text-slate-500">Dokumen belum diajukan.</p>
          ) : (
            <div className="space-y-5">
              {cycles.map((c) => (
                <div key={c}>
                  {maxCycle > 1 && <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Pengajuan ke-{c}</div>}
                  <ol className="space-y-2">
                    {steps
                      .filter((st: { cycle: number }) => st.cycle === c)
                      .map((st: Record<string, unknown>) => (
                        <li key={st.id as string} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                          <span className="font-medium text-slate-900">{STEP_LABEL[st.step_role as string]}</span>
                          <Badge tone={st.decision === "APPROVED" ? "green" : st.decision === "PENDING" ? "amber" : st.decision === "SKIPPED" ? "gray" : "red"}>
                            {DECISION_LABEL[st.decision as string]}
                          </Badge>
                          {!!st.approver && <span className="text-slate-600">{(first(st.approver as { full_name: string }[] | { full_name: string }))?.full_name}</span>}
                          {!!st.decided_at && <span className="text-slate-400">{fmtDateTime(st.decided_at as string)}</span>}
                          {!!st.reason && <span className="w-full text-slate-700">“{st.reason as string}”</span>}
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
