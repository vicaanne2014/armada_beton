import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface WarehouseOpt {
  id: string;
  code: string;
  name: string;
  category: "MATERIAL" | "FINISHED_GOOD";
}
export interface ItemOpt {
  id: string;
  code: string;
  name: string;
  item_type: "MATERIAL" | "FINISHED_GOOD";
  uom: string;
}
export interface LocationOpt {
  id: string;
  warehouse_id: string;
  code: string;
  label: string;
}
export interface PartyOpt {
  id: string;
  code: string;
  name: string;
  party_type: "CUSTOMER" | "SUPPLIER" | "BOTH";
}
export interface PoOpt {
  id: string;
  po_number: string;
  label: string;
}
export interface Lookups {
  warehouses: WarehouseOpt[];
  items: ItemOpt[];
  locations: LocationOpt[];
  parties: PartyOpt[];
  pos: PoOpt[];
}

/** Label penempatan dengan jalur induknya: "Zona A › Rak 1". */
export function buildLocationLabels(
  rows: Array<{ id: string; parent_id: string | null; name: string; code: string }>,
): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const parts: string[] = [];
    let cur: (typeof rows)[number] | undefined = r;
    let guard = 0;
    while (cur && guard++ < 20) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    out.set(r.id, `${parts.join(" › ")} (${r.code})`);
  }
  return out;
}

export async function getLookups(supabase: Supabase): Promise<Lookups> {
  const [wh, it, loc, pt, po] = await Promise.all([
    supabase.from("warehouse").select("id, code, name, category").eq("is_active", true).order("code"),
    supabase.from("item").select("id, code, name, item_type, uom:uom(code)").eq("is_active", true).order("code"),
    supabase.from("location").select("id, warehouse_id, parent_id, code, name").eq("is_active", true).order("code"),
    supabase.from("party").select("id, code, name, party_type").eq("is_active", true).order("name"),
    supabase
      .from("v_production_po_progress")
      .select("id, po_number, status, finished_item_code, remaining_qty")
      .eq("status", "ACTIVE")
      .order("po_number"),
  ]);
  const labels = buildLocationLabels(loc.data ?? []);
  return {
    warehouses: (wh.data ?? []) as WarehouseOpt[],
    items: (it.data ?? []).map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      item_type: i.item_type,
      uom: (i.uom as unknown as { code: string } | null)?.code ?? "",
    })),
    locations: (loc.data ?? []).map((l) => ({
      id: l.id,
      warehouse_id: l.warehouse_id,
      code: l.code,
      label: labels.get(l.id) ?? l.code,
    })),
    parties: (pt.data ?? []) as PartyOpt[],
    pos: (po.data ?? []).map((p) => ({
      id: p.id,
      po_number: p.po_number,
      label: `${p.po_number} — ${p.finished_item_code} (sisa ${Number(p.remaining_qty)})`,
    })),
  };
}

/** Gudang yang boleh dipilih user: keanggotaan + gudang yang ia pimpin/wakili. */
export async function getMyWarehouseIds(supabase: Supabase, userId: string): Promise<string[]> {
  const [mem, head] = await Promise.all([
    supabase.from("user_warehouse").select("warehouse_id").eq("user_id", userId),
    supabase.from("warehouse").select("id").or(`head_user_id.eq.${userId},deputy_user_id.eq.${userId}`),
  ]);
  return [...new Set([...(mem.data ?? []).map((m) => m.warehouse_id), ...(head.data ?? []).map((h) => h.id)])];
}
