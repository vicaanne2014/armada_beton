import Link from "next/link";
import { Badge, Card, Empty } from "@/components/ui";
import { docHref, docTypeByType } from "@/lib/domain/doc-types";
import { fmtDateTime, fmtQty, STATUS_LABEL, STATUS_TONE, STEP_LABEL } from "@/lib/format";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export interface WidgetProps {
  supabase: Supabase;
  userId: string;
  warehouseId: string | null;
}

/** Awal hari ini menurut Asia/Jakarta, sebagai ISO UTC. */
const startOfTodayJakarta = () => {
  const jkt = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${jkt}T00:00:00+07:00`).toISOString();
};

async function PendingDecisions({ supabase }: WidgetProps) {
  const { data } = await supabase
    .from("v_inbox")
    .select("id, doc_type, doc_no, step_role, submitted_at")
    .order("submitted_at")
    .limit(5);
  const { count } = await supabase.from("v_inbox").select("id", { count: "exact", head: true });
  return (
    <Card title="Menunggu keputusan saya" action={<Link href="/approvals" className="text-sm text-blue-700 hover:underline">Lihat semua</Link>}>
      <div className="mb-3 text-3xl font-semibold">{count ?? 0}</div>
      {!data?.length ? (
        <Empty>Tidak ada dokumen menunggu.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <Link href={docHref(d.doc_type, d.id)} className="font-medium text-blue-700 hover:underline">{d.doc_no}</Link>
              <span className="text-slate-500">{docTypeByType(d.doc_type)?.label} · {STEP_LABEL[d.step_role]?.split(" ")[0]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function MyDocuments({ supabase, userId }: WidgetProps) {
  const { data } = await supabase.from("document").select("status").eq("created_by", userId);
  const counts = new Map<string, number>();
  for (const d of data ?? []) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
  return (
    <Card title="Dokumen saya">
      {!data?.length ? (
        <Empty>Anda belum membuat dokumen.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {Object.keys(STATUS_LABEL).map((st) => (
            <li key={st} className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
              <span className="font-semibold tabular-nums">{counts.get(st) ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function StockByWarehouse({ supabase, warehouseId }: WidgetProps) {
  let q = supabase.from("v_stock").select("warehouse_code, warehouse_name, item_id, location_id, qty").gt("qty", 0).limit(5000);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data } = await q;
  const by = new Map<string, { name: string; items: Set<string>; locs: Set<string> }>();
  for (const r of data ?? []) {
    const e = by.get(r.warehouse_code) ?? { name: r.warehouse_name, items: new Set<string>(), locs: new Set<string>() };
    e.items.add(r.item_id);
    e.locs.add(r.location_id);
    by.set(r.warehouse_code, e);
  }
  return (
    <Card title="Ringkasan stok per gudang" action={<Link href="/stock" className="text-sm text-blue-700 hover:underline">Detail</Link>}>
      {!by.size ? (
        <Empty>Belum ada stok.</Empty>
      ) : (
        <ul className="space-y-3">
          {[...by.entries()].map(([code, e]) => (
            <li key={code} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{code} <span className="font-normal text-slate-500">{e.name}</span></span>
              <span className="text-slate-600">{e.items.size} item · {e.locs.size} penempatan</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function LowStock({ supabase, warehouseId }: WidgetProps) {
  let q = supabase.from("v_stock").select("warehouse_code, item_id, item_code, item_name, uom_code, min_stock, qty").not("min_stock", "is", null).limit(5000);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data } = await q;
  const by = new Map<string, { wh: string; code: string; name: string; uom: string; min: number; qty: number }>();
  for (const r of data ?? []) {
    const k = `${r.warehouse_code}:${r.item_id}`;
    const e = by.get(k) ?? { wh: r.warehouse_code, code: r.item_code, name: r.item_name, uom: r.uom_code, min: Number(r.min_stock), qty: 0 };
    e.qty += Number(r.qty);
    by.set(k, e);
  }
  const low = [...by.values()].filter((e) => e.qty < e.min).sort((a, b) => a.qty / a.min - b.qty / b.min);
  return (
    <Card title="Stok di bawah minimum">
      {!low.length ? (
        <Empty>Semua item di atas batas minimum.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {low.slice(0, 6).map((e) => (
            <li key={`${e.wh}:${e.code}`} className="flex items-center justify-between gap-2">
              <span>{e.code} <span className="text-slate-500">({e.wh})</span></span>
              <span className="tabular-nums text-red-700">{fmtQty(e.qty)} / {fmtQty(e.min)} {e.uom}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function TodayFlow({ supabase, warehouseId }: WidgetProps) {
  let q = supabase.from("document").select("doc_type").eq("status", "TERVALIDASI").gte("validated_at", startOfTodayJakarta());
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data } = await q;
  const counts = new Map<string, number>();
  for (const d of data ?? []) counts.set(d.doc_type, (counts.get(d.doc_type) ?? 0) + 1);
  return (
    <Card title="Aktivitas hari ini">
      {!data?.length ? (
        <Empty>Belum ada dokumen divalidasi hari ini.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {[...counts.entries()].map(([t, n]) => (
            <li key={t} className="flex justify-between"><span>{docTypeByType(t)?.label}</span><span className="font-semibold tabular-nums">{n}</span></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function RecentMovements({ supabase, warehouseId }: WidgetProps) {
  let q = supabase
    .from("v_movement")
    .select("id, posted_at, doc_no, document_id, doc_type, item_code, location_code, qty_in, qty_out")
    .order("id", { ascending: false })
    .limit(8);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data } = await q;
  return (
    <Card title="Mutasi stok terbaru" action={<Link href="/reports/movements" className="text-sm text-blue-700 hover:underline">Laporan</Link>}>
      {!data?.length ? (
        <Empty>Belum ada pergerakan stok.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span>
                <Link href={docHref(m.doc_type, m.document_id)} className="font-medium text-blue-700 hover:underline">{m.doc_no}</Link>
                <span className="ml-2 text-slate-500">{m.item_code} @ {m.location_code}</span>
              </span>
              <span className={`tabular-nums ${Number(m.qty_in) > 0 ? "text-green-700" : "text-red-700"}`}>
                {Number(m.qty_in) > 0 ? `+${fmtQty(m.qty_in)}` : `−${fmtQty(m.qty_out)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!!data?.length && <p className="mt-3 text-xs text-slate-400">Terakhir: {fmtDateTime(data[0].posted_at)}</p>}
    </Card>
  );
}

async function PoProgress({ supabase }: WidgetProps) {
  const { data } = await supabase
    .from("v_production_po_progress")
    .select("id, po_number, finished_item_code, target_qty, received_qty")
    .eq("status", "ACTIVE")
    .order("po_number", { ascending: false })
    .limit(20);
  const open = (data ?? []).filter((p) => Number(p.received_qty) < Number(p.target_qty)).slice(0, 5);
  return (
    <Card title="Progres PO produksi" action={<Link href="/po" className="text-sm text-blue-700 hover:underline">Semua PO</Link>}>
      {!open.length ? (
        <Empty>Tidak ada PO aktif yang belum selesai.</Empty>
      ) : (
        <ul className="space-y-3 text-sm">
          {open.map((p) => {
            const pct = Math.min(100, Math.round((Number(p.received_qty) / Number(p.target_qty)) * 100));
            return (
              <li key={p.id}>
                <div className="flex justify-between">
                  <Link href={`/po/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.po_number}</Link>
                  <span className="tabular-nums text-slate-600">{fmtQty(p.received_qty)} / {fmtQty(p.target_qty)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export const WIDGET_COMPONENTS: Record<string, (p: WidgetProps) => Promise<React.JSX.Element>> = {
  pending_decisions: PendingDecisions,
  my_documents: MyDocuments,
  stock_by_warehouse: StockByWarehouse,
  low_stock: LowStock,
  today_flow: TodayFlow,
  recent_movements: RecentMovements,
  po_progress: PoProgress,
};
