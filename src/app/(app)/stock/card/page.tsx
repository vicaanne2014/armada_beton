import Link from "next/link";
import { Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { docHref } from "@/lib/domain/doc-types";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { buildLocationLabels } from "@/lib/lookups";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const DOC_LABEL: Record<string, string> = {
  SALDO_AWAL: "Saldo awal",
  MATERIAL_RECEIPT: "Penerimaan Material",
  MATERIAL_REQUEST: "Permintaan Material",
  STOCK_TRANSFER: "Pemindahan",
  FG_RECEIPT: "Penerimaan Barang Jadi",
  DELIVERY_NOTE: "Pengiriman",
  STOCK_OPNAME: "Stock Opname",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function StockCardPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; location?: string; from?: string; to?: string }>;
}) {
  await requireAnyPerm("report.movement", "stock.read.all", "report.read.all");
  const sp = await searchParams;
  const supabase = await createClient();

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const to = sp.to ?? ymd(new Date());
  const from = sp.from ?? ymd(monthAgo);
  const [{ data: items }, { data: locs }] = await Promise.all([
    supabase.from("item").select("id, code, name").order("code"),
    supabase.from("location").select("id, parent_id, code, name, warehouse_id").order("code"),
  ]);
  const labels = buildLocationLabels(locs ?? []);

  let card: Array<Record<string, unknown>> = [];
  if (sp.item) {
    const toExclusive = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000).toISOString();
    const { data } = await supabase.rpc("stock_card", {
      p_item: sp.item,
      p_location: sp.location || null,
      p_from: new Date(`${from}T00:00:00+07:00`).toISOString(),
      p_to: toExclusive,
    });
    card = (data ?? []) as Array<Record<string, unknown>>;
  }
  const docIds = [...new Set(card.map((c) => c.document_id as string | null).filter(Boolean))] as string[];
  const { data: docs } = docIds.length
    ? await supabase.from("document").select("id, doc_type").in("id", docIds)
    : { data: [] };
  const docType = new Map((docs ?? []).map((d) => [d.id, d.doc_type]));

  return (
    <>
      <PageHeader title="Kartu Stok" subtitle="Saldo dihitung dari ledger pergerakan yang tidak dapat diubah." />
      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <Field label="Item" className="w-64">
          <Select name="item" defaultValue={sp.item ?? ""} required>
            <option value="">— Pilih item —</option>
            {(items ?? []).map((i) => (
              <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Penempatan" className="w-72">
          <Select name="location" defaultValue={sp.location ?? ""}>
            <option value="">Semua penempatan</option>
            {(locs ?? []).map((l) => (
              <option key={l.id} value={l.id}>{labels.get(l.id)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Dari" className="w-44"><Input type="date" name="from" defaultValue={from} /></Field>
        <Field label="Sampai" className="w-44"><Input type="date" name="to" defaultValue={to} /></Field>
        <Button type="submit">Tampilkan</Button>
      </form>

      <Card>
        {!sp.item ? (
          <Empty>Pilih item untuk melihat kartu stok.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tanggal</Th><Th>Dokumen</Th><Th>Penempatan</Th>
                <Th className="text-right">Masuk</Th><Th className="text-right">Keluar</Th><Th className="text-right">Saldo</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {card.map((c) => {
                const opening = c.doc_type === "SALDO_AWAL";
                const dt = docType.get(c.document_id as string);
                return (
                  <tr key={String(c.id)} className={opening ? "bg-slate-50 font-medium" : ""}>
                    <Td>{opening ? "" : fmtDateTime(c.posted_at as string)}</Td>
                    <Td>
                      {opening ? (
                        "Saldo awal periode"
                      ) : dt ? (
                        <Link href={docHref(dt, c.document_id as string)} className="text-blue-700 hover:underline">
                          {c.doc_no as string}
                        </Link>
                      ) : (
                        (c.doc_no as string)
                      )}
                      {!opening && <span className="ml-2 text-xs text-slate-500">{DOC_LABEL[c.doc_type as string]}</span>}
                    </Td>
                    <Td>{c.location_id ? (labels.get(c.location_id as string) ?? "") : ""}</Td>
                    <Td className="text-right tabular-nums">{opening || Number(c.qty_in) === 0 ? "" : fmtQty(c.qty_in as number)}</Td>
                    <Td className="text-right tabular-nums">{opening || Number(c.qty_out) === 0 ? "" : fmtQty(c.qty_out as number)}</Td>
                    <Td className="text-right tabular-nums">{fmtQty(c.saldo as number)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
