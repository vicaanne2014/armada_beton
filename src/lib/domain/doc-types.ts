export type DocTypeKey =
  | "MATERIAL_RECEIPT"
  | "MATERIAL_REQUEST"
  | "STOCK_TRANSFER"
  | "FG_RECEIPT"
  | "DELIVERY_NOTE"
  | "STOCK_OPNAME";

export type HeaderKind = "text" | "date" | "number" | "party" | "fgitem" | "po" | "textarea";

export interface HeaderField {
  name: string;
  label: string;
  kind: HeaderKind;
  required?: boolean;
  party?: "SUPPLIER" | "CUSTOMER";
  hint?: string;
}

export interface DocTypeDef {
  type: DocTypeKey;
  slug: string;
  label: string;
  menu: string;
  group: "material" | "finished" | "shared";
  /** kategori gudang yang valid; ANY = keduanya (pemindahan) */
  warehouseCategory: "MATERIAL" | "FINISHED_GOOD" | "ANY";
  createPerm: string;
  /** Staff departemen tidak perlu menjadi anggota gudang untuk meminta material. */
  requiresMembership: boolean;
  headerFields: HeaderField[];
  lines: { location: boolean; locationLabel: string; toLocation: boolean };
  /** tabel ekstensi dan kolom header-nya (untuk membaca) */
  ext: string | null;
  extColumns: string;
}

export const DOC_TYPES: DocTypeDef[] = [
  {
    type: "MATERIAL_RECEIPT",
    slug: "material-receipts",
    label: "Penerimaan Material",
    menu: "Penerimaan Material",
    group: "material",
    warehouseCategory: "MATERIAL",
    createPerm: "doc.create.material_receipt",
    requiresMembership: true,
    headerFields: [
      { name: "sj_number", label: "No. Surat Jalan Masuk", kind: "text", required: true },
      { name: "receipt_date", label: "Tanggal Terima", kind: "date", required: true },
      { name: "sender_party_id", label: "Pengirim", kind: "party", required: true, party: "SUPPLIER" },
      {
        name: "po_number",
        label: "No. PO (referensi)",
        kind: "text",
        hint: "Opsional. Dicatat sebagai referensi PO pengirim.",
      },
      { name: "po_date", label: "Tanggal PO", kind: "date" },
    ],
    lines: { location: true, locationLabel: "Penempatan tujuan", toLocation: false },
    ext: "material_receipt",
    extColumns: "sj_number, receipt_date, sender_party_id, po_reference:po_reference(po_number, po_date)",
  },
  {
    type: "MATERIAL_REQUEST",
    slug: "material-requests",
    label: "Permintaan Material",
    menu: "Permintaan Material",
    group: "material",
    warehouseCategory: "MATERIAL",
    createPerm: "doc.create.material_request",
    requiresMembership: false,
    headerFields: [
      {
        name: "po_number",
        label: "No. PO Produksi",
        kind: "text",
        required: true,
        hint: "Diinput manual. Bila nomor sudah ada, produk dan target harus sama.",
      },
      { name: "finished_item_id", label: "Produk Target", kind: "fgitem", required: true },
      { name: "target_qty", label: "Qty Target", kind: "number", required: true },
    ],
    lines: { location: false, locationLabel: "", toLocation: false },
    ext: "material_request",
    extColumns: "po_number, finished_item_id, target_qty, production_po_id",
  },
  {
    type: "STOCK_TRANSFER",
    slug: "stock-transfers",
    label: "Pemindahan Penempatan",
    menu: "Pemindahan Penempatan",
    group: "shared",
    warehouseCategory: "ANY",
    createPerm: "doc.create.stock_transfer",
    requiresMembership: true,
    headerFields: [],
    lines: { location: true, locationLabel: "Dari penempatan", toLocation: true },
    ext: null,
    extColumns: "",
  },
  {
    type: "FG_RECEIPT",
    slug: "fg-receipts",
    label: "Penerimaan Barang Jadi",
    menu: "Penerimaan Barang Jadi",
    group: "finished",
    warehouseCategory: "FINISHED_GOOD",
    createPerm: "doc.create.fg_receipt",
    requiresMembership: true,
    headerFields: [
      {
        name: "production_po_id",
        label: "PO Produksi",
        kind: "po",
        required: true,
        hint: "Hanya PO yang sudah ada dan memiliki permintaan material tervalidasi.",
      },
    ],
    lines: { location: true, locationLabel: "Penempatan tujuan", toLocation: false },
    ext: "fg_receipt",
    extColumns: "production_po_id",
  },
  {
    type: "DELIVERY_NOTE",
    slug: "delivery-notes",
    label: "Pengiriman Barang Jadi",
    menu: "Pengiriman & Surat Jalan",
    group: "finished",
    warehouseCategory: "FINISHED_GOOD",
    createPerm: "doc.create.delivery_note",
    requiresMembership: true,
    headerFields: [
      { name: "customer_id", label: "Customer Tujuan", kind: "party", required: true, party: "CUSTOMER" },
      { name: "delivery_date", label: "Tanggal Kirim", kind: "date", required: true },
      { name: "customer_po_ref", label: "Referensi PO Customer", kind: "text", hint: "Opsional." },
    ],
    lines: { location: true, locationLabel: "Penempatan sumber", toLocation: false },
    ext: "delivery_note",
    extColumns: "customer_id, delivery_date, customer_po_ref, sj_number",
  },
  {
    // Form khusus (sesi + hitungan), bukan DocForm generik. Baris disimpan di opname_line.
    type: "STOCK_OPNAME",
    slug: "stock-opnames",
    label: "Stock Opname",
    menu: "Stock Opname",
    group: "shared",
    warehouseCategory: "ANY",
    createPerm: "doc.create.stock_opname",
    requiresMembership: true,
    headerFields: [],
    lines: { location: false, locationLabel: "", toLocation: false },
    ext: null,
    extColumns: "",
  },
];

export const docTypeBySlug = (slug: string) => DOC_TYPES.find((d) => d.slug === slug);
export const docTypeByType = (t: string) => DOC_TYPES.find((d) => d.type === t);
export const docHref = (type: string, id: string) => `/docs/${docTypeByType(type)?.slug ?? "x"}/${id}`;
