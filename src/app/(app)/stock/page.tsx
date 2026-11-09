import Link from "next/link";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; q?: string; low?: string }>;
}) {
  await requireAnyPerm("report.stock", "stock.read.all", "report.read.all");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: warehouses } = await supabase.from("warehouse").select("id, code, name").eq("is_active", true).order("code");
  let q = supabase
    .from("v_stock")
    .select("item_id, item_code, item_name, uom_code, min_stock, location_id, location_code, location_name, warehouse_id, warehouse_code, qty")
    .order("warehouse_code")
    .order("item_code")
    .order("location_code")
    .limit(2000);
  if (sp.warehouse) q = q.eq("warehouse_id", sp.warehouse);
  if (sp.q) q = q.or(`item_code.ilike.%${sp.q.replace(/[%,()]/g, "")}%,item_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  const { data: rows } = await q;
  const { data: locks } = await supabase.from("opname_lock").select("location:location(code)");
  const lockedCodes = (locks ?? [])
    .map((r) => (Array.isArray(r.location) ? r.location[0] : (r.location as unknown as { code: string } | null))?.code)
    .filter(Boolean) as string[];

  // total per (gudang, item)
  const totals = new Map<string, { item_code: string; item_name: string; uom: string; wh: string; min: number | null; qty: number; item_id: string }>();
  for (const r of rows ?? []) {
    const k = `${r.warehouse_id}:${r.item_id}`;
    const t = totals.get(k) ?? { item_code: r.item_code, item_name: r.item_name, uom: r.uom_code, wh: r.warehouse_code, min: r.min_stock === null ? null : Number(r.min_stock), qty: 0, item_id: r.item_id };
    t.qty += Number(r.qty);
    totals.set(k, t);
  }
  const summary = [...totals.values()].filter((t) => (sp.low ? t.min !== null && t.qty < t.min : true));
  const detail = (rows ?? []).filter((r) => Number(r.qty) > 0 || sp.q);

  return (
    <>
      <PageHeader title="Stok & Kartu Stok" subtitle="Stok per item dan per penempatan. Angka berubah hanya saat dokumen divalidasi." />
      {lockedCodes.length > 0 && (
        <Alert tone="warn" className="mb-5">
          {lockedCodes.length} penempatan sedang dihitung (stock opname): {lockedCodes.slice(0, 12).join(", ")}
          {lockedCodes.length > 12 ? ", …" : ""}. Transaksi pada penempatan tersebut tertahan sampai opname selesai.
        </Alert>
      )}
      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <Field label="Gudang" className="w-56">
          <Select name="warehouse" defaultValue={sp.warehouse ?? ""}>
            <option value="">Semua gudang</option>
            {(warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cari item" className="w-56">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="kode / nama" />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="low" value="1" defaultChecked={Boolean(sp.low)} /> Hanya di bawah stok minimum
        </label>
        <Button type="submit" variant="secondary">Terapkan</Button>
      </form>

      <div className="space-y-6">
        <Card title="Total per item">
          {!summary.length ? (
            <Empty>Tidak ada data stok.</Empty>
          ) : (
            <Table>
              <thead>
                <tr><Th>Gudang</Th><Th>Item</Th><Th className="text-right">Total</Th><Th className="text-right">Minimum</Th><Th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.map((t) => (
                  <tr key={`${t.wh}:${t.item_id}`}>
                    <Td>{t.wh}</Td>
                    <Td>{t.item_code} — {t.item_name}</Td>
                    <Td className="text-right tabular-nums">{fmtQty(t.qty)} {t.uom}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{t.min === null ? "-" : fmtQty(t.min)}</Td>
                    <Td>{t.min !== null && t.qty < t.min && <Badge tone="red">Di bawah minimum</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Rincian per penempatan">
          {!detail.length ? (
            <Empty>Tidak ada stok.</Empty>
          ) : (
            <Table>
              <thead>
                <tr><Th>Gudang</Th><Th>Penempatan</Th><Th>Item</Th><Th className="text-right">Qty</Th><Th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.map((r) => (
                  <tr key={`${r.item_id}:${r.location_id}`}>
                    <Td>{r.warehouse_code}</Td>
                    <Td>{r.location_code} <span className="text-slate-500">{r.location_name}</span></Td>
                    <Td>{r.item_code} — {r.item_name}</Td>
                    <Td className="text-right tabular-nums">{fmtQty(r.qty)} {r.uom_code}</Td>
                    <Td>
                      <Link href={`/stock/card?item=${r.item_id}&location=${r.location_id}`} className="text-blue-700 hover:underline">
                        Kartu stok
                      </Link>
                    </Td>
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
