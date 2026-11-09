import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function PoListPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_production_po_progress")
    .select("id, po_number, status, target_qty, finished_item_code, finished_item_name, received_qty, remaining_qty")
    .order("po_number", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader
        title="PO Produksi"
        subtitle="PO lahir dari permintaan material dan diinput manual. Penerimaan barang jadi hanya bisa memilih PO yang sudah ada."
      />
      <Card>
        {!data?.length ? (
          <Empty>Belum ada PO produksi.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>No. PO</Th><Th>Produk</Th><Th className="text-right">Target</Th>
                <Th className="text-right">Diterima</Th><Th className="text-right">Sisa</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td><Link href={`/po/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.po_number}</Link></Td>
                  <Td>{p.finished_item_code} — {p.finished_item_name}</Td>
                  <Td className="text-right tabular-nums">{fmtQty(p.target_qty)}</Td>
                  <Td className="text-right tabular-nums">{fmtQty(p.received_qty)}</Td>
                  <Td className={`text-right tabular-nums ${Number(p.remaining_qty) < 0 ? "text-red-700" : ""}`}>{fmtQty(p.remaining_qty)}</Td>
                  <Td>
                    <Badge tone={p.status === "ACTIVE" ? "green" : "amber"}>
                      {p.status === "ACTIVE" ? "Aktif" : "Menunggu validasi permintaan"}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
