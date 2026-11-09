import "server-only";

export type FieldType = "text" | "textarea" | "number" | "select" | "bool";

export interface FieldOption {
  value: string;
  label: string;
  /** dipakai bila field memiliki groupBy: opsi hanya tampil bila nilai field induk sama */
  group?: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  /** opsi diisi dari data (diselesaikan di halaman) */
  optionsFrom?: "users" | "departments" | "uoms";
  groupBy?: string;
  /** hanya bisa diisi saat membuat */
  createOnly?: boolean;
  hint?: string;
}

export interface MasterDef {
  key: string;
  table: string;
  title: string;
  description: string;
  select: string;
  cols: Array<{ label: string; get: (row: Record<string, unknown>) => string }>;
  fields: FieldDef[];
  orderBy: string;
}

const CATEGORY: FieldOption[] = [
  { value: "MATERIAL", label: "Material" },
  { value: "FINISHED_GOOD", label: "Barang Jadi" },
];

const rel = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
const yesNo = (b: unknown) => (b ? "Aktif" : "Nonaktif");
const catLabel = (v: unknown) => (v === "MATERIAL" ? "Material" : v === "FINISHED_GOOD" ? "Barang Jadi" : String(v ?? ""));

export const MASTER: Record<string, MasterDef> = {
  warehouses: {
    key: "warehouses",
    table: "warehouse",
    title: "Gudang",
    description: "Gudang baru dapat ditambah kapan saja tanpa perubahan kode. Kategori tidak bisa diubah setelah ada dokumen.",
    select: "id, code, name, category, is_active, head_user_id, deputy_user_id, head:app_user!head_user_id(full_name), deputy:app_user!deputy_user_id(full_name)",
    orderBy: "code",
    cols: [
      { label: "Kode", get: (r) => String(r.code) },
      { label: "Nama", get: (r) => String(r.name) },
      { label: "Kategori", get: (r) => catLabel(r.category) },
      { label: "Kepala Gudang", get: (r) => rel<{ full_name: string }>(r.head)?.full_name ?? "-" },
      { label: "Deputi", get: (r) => rel<{ full_name: string }>(r.deputy)?.full_name ?? "-" },
      { label: "Status", get: (r) => yesNo(r.is_active) },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "category", label: "Kategori", type: "select", required: true, createOnly: true, options: CATEGORY },
      { name: "head_user_id", label: "Kepala Gudang", type: "select", optionsFrom: "users", hint: "Memvalidasi dokumen gudang ini." },
      { name: "deputy_user_id", label: "Deputi (pengganti)", type: "select", optionsFrom: "users", hint: "Opsional. Bisa memvalidasi bila Kepala berhalangan atau menjadi pembuat dokumen." },
      { name: "is_active", label: "Aktif", type: "bool" },
    ],
  },
  departments: {
    key: "departments",
    table: "department",
    title: "Departemen",
    description: "Kepala Departemen menyetujui dokumen yang dibuat anggota departemennya.",
    select: "id, code, name, is_active, head_user_id, deputy_user_id, head:app_user!head_user_id(full_name), deputy:app_user!deputy_user_id(full_name)",
    orderBy: "code",
    cols: [
      { label: "Kode", get: (r) => String(r.code) },
      { label: "Nama", get: (r) => String(r.name) },
      { label: "Kepala Departemen", get: (r) => rel<{ full_name: string }>(r.head)?.full_name ?? "-" },
      { label: "Deputi", get: (r) => rel<{ full_name: string }>(r.deputy)?.full_name ?? "-" },
      { label: "Status", get: (r) => yesNo(r.is_active) },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "head_user_id", label: "Kepala Departemen", type: "select", optionsFrom: "users" },
      { name: "deputy_user_id", label: "Deputi (pengganti)", type: "select", optionsFrom: "users" },
      { name: "is_active", label: "Aktif", type: "bool" },
    ],
  },
  uoms: {
    key: "uoms",
    table: "uom",
    title: "Satuan",
    description: "Satuan material dan satuan barang jadi dikelola terpisah. Item hanya boleh memakai satuan sejenis.",
    select: "id, code, name, uom_type, is_active",
    orderBy: "code",
    cols: [
      { label: "Kode", get: (r) => String(r.code) },
      { label: "Nama", get: (r) => String(r.name) },
      { label: "Jenis", get: (r) => catLabel(r.uom_type) },
      { label: "Status", get: (r) => yesNo(r.is_active) },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "uom_type", label: "Jenis satuan", type: "select", required: true, createOnly: true, options: CATEGORY },
      { name: "is_active", label: "Aktif", type: "bool" },
    ],
  },
  items: {
    key: "items",
    table: "item",
    title: "Item",
    description: "Item material dan barang jadi. Satuan harus sejenis dengan item dan tidak bisa diganti setelah ada pergerakan stok.",
    select: "id, code, name, item_type, min_stock, is_active, uom_id, uom:uom(code)",
    orderBy: "code",
    cols: [
      { label: "Kode", get: (r) => String(r.code) },
      { label: "Nama", get: (r) => String(r.name) },
      { label: "Jenis", get: (r) => catLabel(r.item_type) },
      { label: "Satuan", get: (r) => rel<{ code: string }>(r.uom)?.code ?? "-" },
      { label: "Stok minimum", get: (r) => (r.min_stock === null || r.min_stock === undefined ? "-" : String(Number(r.min_stock))) },
      { label: "Status", get: (r) => yesNo(r.is_active) },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "item_type", label: "Jenis item", type: "select", required: true, createOnly: true, options: CATEGORY },
      { name: "uom_id", label: "Satuan", type: "select", required: true, optionsFrom: "uoms", groupBy: "item_type" },
      { name: "min_stock", label: "Stok minimum", type: "number", hint: "Opsional. Dipakai untuk peringatan di dashboard." },
      { name: "is_active", label: "Aktif", type: "bool" },
    ],
  },
  parties: {
    key: "parties",
    table: "party",
    title: "Customer & Pengirim",
    description: "Customer penerima surat jalan keluar dan pengirim/supplier material.",
    select: "id, code, name, party_type, address, is_active",
    orderBy: "name",
    cols: [
      { label: "Kode", get: (r) => String(r.code) },
      { label: "Nama", get: (r) => String(r.name) },
      { label: "Jenis", get: (r) => ({ CUSTOMER: "Customer", SUPPLIER: "Pengirim/Supplier", BOTH: "Keduanya" })[String(r.party_type)] ?? "" },
      { label: "Alamat", get: (r) => String(r.address ?? "") },
      { label: "Status", get: (r) => yesNo(r.is_active) },
    ],
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "party_type",
        label: "Jenis",
        type: "select",
        required: true,
        options: [
          { value: "CUSTOMER", label: "Customer" },
          { value: "SUPPLIER", label: "Pengirim/Supplier" },
          { value: "BOTH", label: "Keduanya" },
        ],
      },
      { name: "address", label: "Alamat", type: "textarea" },
      { name: "is_active", label: "Aktif", type: "bool" },
    ],
  },
};

export const MASTER_LIST = Object.values(MASTER);
