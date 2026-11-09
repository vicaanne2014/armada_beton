import "server-only";
import { DOC_TYPES } from "@/lib/domain/doc-types";
import { first } from "@/lib/documents";
import { STATUS_LABEL } from "@/lib/format";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ColKind = "text" | "qty" | "date" | "datetime";
export interface ReportCol {
  key: string;
  label: string;
  kind: ColKind;
}
export type ReportKey = "stock" | "movements" | "documents";
export interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  perm: string;
  columns: ReportCol[];
}
export interface ReportParams {
  warehouse?: string;
  q?: string;
  from?: string;
  to?: string;
  type?: string;
  status?: string;
}
export type ReportRow = Record<string, string | number | null>;

export const REPORTS: ReportDef[] = [
  {
    key: "stock",
    title: "Laporan Stok",
    description: "Stok saat ini per gudang, penempatan, dan item.",
    perm: "report.stock",
    columns: [
      { key: "warehouse", label: "Gudang", kind: "text" },
      { key: "location", label: "Penempatan", kind: "text" },
      { key: "item_code", label: "Kode Item", kind: "text" },
      { key: "item_name", label: "Nama Item", kind: "text" },
      { key: "qty", label: "Qty", kind: "qty" },
      { key: "uom", label: "Satuan", kind: "text" },
    ],
  },
  {
    key: "movements",
    title: "Laporan Mutasi Stok",
    description: "Seluruh pergerakan stok (masuk/keluar) pada periode tertentu, lengkap dengan dokumen dan pelakunya.",
    perm: "report.movement",
    columns: [
      { key: "posted_at", label: "Tanggal", kind: "datetime" },
      { key: "doc_no", label: "Dokumen", kind: "text" },
      { key: "doc_type", label: "Jenis", kind: "text" },
      { key: "warehouse", label: "Gudang", kind: "text" },
      { key: "location", label: "Penempatan", kind: "text" },
      { key: "item_code", label: "Kode Item", kind: "text" },
      { key: "item_name", label: "Nama Item", kind: "text" },
      { key: "qty_in", label: "Masuk", kind: "qty" },
      { key: "qty_out", label: "Keluar", kind: "qty" },
      { key: "posted_by", label: "Oleh", kind: "text" },
    ],
  },
  {
    key: "documents",
    title: "Laporan Dokumen",
    description: "Penerimaan, permintaan, pemindahan, dan pengiriman beserta status approval.",
    perm: "report.documents",
    columns: [
      { key: "doc_no", label: "Nomor", kind: "text" },
      { key: "doc_type", label: "Jenis", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "warehouse", label: "Gudang", kind: "text" },
      { key: "creator", label: "Dibuat oleh", kind: "text" },
      { key: "created_at", label: "Dibuat", kind: "datetime" },
      { key: "validated_at", label: "Divalidasi", kind: "datetime" },
    ],
  },
];

export const reportByKey = (k: string) => REPORTS.find((r) => r.key === k);
const typeLabel = (t: string) => DOC_TYPES.find((d) => d.type === t)?.label ?? t;
const safe = (s: string) => s.replace(/[%,()*]/g, "");
// tanggal lokal Asia/Jakarta -> batas waktu UTC
const dayStart = (d: string) => new Date(`${d}T00:00:00+07:00`).toISOString();
const dayEndExclusive = (d: string) => new Date(new Date(`${d}T00:00:00+07:00`).getTime() + 86400_000).toISOString();

export async function fetchReport(
  supabase: Supabase,
  key: ReportKey,
  p: ReportParams,
  limit = 5000,
): Promise<ReportRow[]> {
  if (key === "stock") {
    let q = supabase
      .from("v_stock")
      .select("warehouse_code, location_code, item_code, item_name, qty, uom_code")
      .gt("qty", 0)
      .order("warehouse_code")
      .order("location_code")
      .order("item_code")
      .limit(limit);
    if (p.warehouse) q = q.eq("warehouse_id", p.warehouse);
    if (p.q) q = q.or(`item_code.ilike.%${safe(p.q)}%,item_name.ilike.%${safe(p.q)}%`);
    const { data } = await q;
    return (data ?? []).map((r) => ({
      warehouse: r.warehouse_code,
      location: r.location_code,
      item_code: r.item_code,
      item_name: r.item_name,
      qty: Number(r.qty),
      uom: r.uom_code,
    }));
  }

  if (key === "movements") {
    let q = supabase
      .from("v_movement")
      .select("posted_at, doc_no, doc_type, warehouse_code, location_code, item_code, item_name, qty_in, qty_out, posted_by_name")
      .order("id", { ascending: false })
      .limit(limit);
    if (p.warehouse) q = q.eq("warehouse_id", p.warehouse);
    if (p.q) q = q.or(`item_code.ilike.%${safe(p.q)}%,item_name.ilike.%${safe(p.q)}%`);
    if (p.from) q = q.gte("posted_at", dayStart(p.from));
    if (p.to) q = q.lt("posted_at", dayEndExclusive(p.to));
    const { data } = await q;
    return (data ?? []).map((r) => ({
      posted_at: r.posted_at,
      doc_no: r.doc_no,
      doc_type: typeLabel(r.doc_type),
      warehouse: r.warehouse_code,
      location: r.location_code,
      item_code: r.item_code,
      item_name: r.item_name,
      qty_in: Number(r.qty_in),
      qty_out: Number(r.qty_out),
      posted_by: r.posted_by_name,
    }));
  }

  let q = supabase
    .from("document")
    .select("doc_no, doc_type, status, created_at, validated_at, warehouse:warehouse(code), creator:app_user!created_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (p.warehouse) q = q.eq("warehouse_id", p.warehouse);
  if (p.type) q = q.eq("doc_type", p.type);
  if (p.status) q = q.eq("status", p.status);
  if (p.from) q = q.gte("created_at", dayStart(p.from));
  if (p.to) q = q.lt("created_at", dayEndExclusive(p.to));
  const { data } = await q;
  return (data ?? []).map((r) => ({
    doc_no: r.doc_no,
    doc_type: typeLabel(r.doc_type),
    status: STATUS_LABEL[r.status] ?? r.status,
    warehouse: first(r.warehouse as { code: string } | { code: string }[] | null)?.code ?? null,
    creator: first(r.creator as { full_name: string } | { full_name: string }[] | null)?.full_name ?? null,
    created_at: r.created_at,
    validated_at: r.validated_at,
  }));
}
