export interface WidgetMeta {
  key: string;
  label: string;
  description: string;
}

export const WIDGETS: WidgetMeta[] = [
  { key: "pending_decisions", label: "Menunggu keputusan saya", description: "Dokumen yang menunggu approval atau validasi Anda." },
  { key: "my_documents", label: "Dokumen saya", description: "Jumlah dokumen buatan Anda per status." },
  { key: "stock_by_warehouse", label: "Ringkasan stok per gudang", description: "Jumlah item berstok dan penempatan terisi." },
  { key: "low_stock", label: "Stok di bawah minimum", description: "Item yang total stoknya di bawah batas minimum." },
  { key: "today_flow", label: "Aktivitas hari ini", description: "Dokumen yang divalidasi hari ini per jenis." },
  { key: "recent_movements", label: "Mutasi stok terbaru", description: "Pergerakan stok terakhir." },
  { key: "po_progress", label: "Progres PO produksi", description: "PO aktif dan sisa barang jadi yang belum diterima." },
];

export const DEFAULT_BY_ROLE: Record<string, string[]> = {
  STAFF_GUDANG_MATERIAL: ["my_documents", "stock_by_warehouse", "today_flow", "recent_movements"],
  STAFF_GUDANG_BJ: ["my_documents", "stock_by_warehouse", "po_progress", "today_flow", "recent_movements"],
  STAFF_DEPT: ["my_documents", "po_progress"],
  KEPALA_DEPT: ["pending_decisions", "my_documents", "stock_by_warehouse", "po_progress"],
  KEPALA_GUDANG: ["pending_decisions", "stock_by_warehouse", "low_stock", "today_flow", "recent_movements"],
  ADMIN: ["pending_decisions", "stock_by_warehouse", "low_stock", "today_flow", "po_progress", "recent_movements"],
  MANAJEMEN: ["stock_by_warehouse", "low_stock", "today_flow", "po_progress", "recent_movements"],
};

export interface DashboardConfig {
  keys: string[] | null;
  warehouseId: string | null;
}

/** Konfigurasi tersimpan di jsonb. Bentuk tak dikenal diabaikan agar aman terhadap data lama. */
export function parseDashboardConfig(raw: unknown): DashboardConfig {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { keys?: unknown; warehouse_id?: unknown };
    const keys = Array.isArray(o.keys) ? o.keys.filter((k): k is string => typeof k === "string") : null;
    return { keys, warehouseId: typeof o.warehouse_id === "string" ? o.warehouse_id : null };
  }
  if (Array.isArray(raw) && raw.length) return { keys: raw.filter((k): k is string => typeof k === "string"), warehouseId: null };
  return { keys: null, warehouseId: null };
}
