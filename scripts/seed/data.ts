/**
 * Data master demo untuk batching plant beton precast (beton pracetak: U-ditch, buis, paving, kansteen).
 * Semua nama pihak luar bertanda (demo) agar tidak tertukar dengan data nyata.
 * Satu satuan dasar per item, tanpa konversi (default PRD, Open Question #4).
 */

export const DEPARTMENTS = [
  { code: "PROD", name: "Produksi" },
  { code: "GDG", name: "Gudang" },
  { code: "MGT", name: "Manajemen" },
];

export const UOMS = [
  // satuan material
  { code: "SAK", name: "Sak (50 kg)", uom_type: "MATERIAL" },
  { code: "M3", name: "Meter kubik", uom_type: "MATERIAL" },
  { code: "KG", name: "Kilogram", uom_type: "MATERIAL" },
  { code: "LTR", name: "Liter", uom_type: "MATERIAL" },
  { code: "BH", name: "Buah", uom_type: "MATERIAL" },
  // satuan barang jadi
  { code: "PCS", name: "Pcs", uom_type: "FINISHED_GOOD" },
  { code: "M2", name: "Meter persegi", uom_type: "FINISHED_GOOD" },
  { code: "BTG", name: "Batang", uom_type: "FINISHED_GOOD" },
];

export interface ItemSeed {
  code: string;
  name: string;
  item_type: "MATERIAL" | "FINISHED_GOOD";
  uom: string;
  min_stock?: number;
}

export const ITEMS: ItemSeed[] = [
  // ---- material ----
  { code: "SEMEN-PC", name: "Semen Portland Tipe I 50 kg", item_type: "MATERIAL", uom: "SAK", min_stock: 500 },
  { code: "PASIR", name: "Pasir Beton", item_type: "MATERIAL", uom: "M3", min_stock: 120 },
  { code: "BATU-12", name: "Batu Split 1-2 cm", item_type: "MATERIAL", uom: "M3", min_stock: 40 },
  { code: "BATU-05", name: "Batu Split 0,5-1 cm", item_type: "MATERIAL", uom: "M3", min_stock: 20 },
  { code: "FLYASH", name: "Fly Ash", item_type: "MATERIAL", uom: "KG", min_stock: 5000 },
  { code: "ADT-SP", name: "Aditif Superplasticizer", item_type: "MATERIAL", uom: "LTR", min_stock: 300 },
  { code: "ADT-RT", name: "Aditif Retarder", item_type: "MATERIAL", uom: "LTR", min_stock: 50 },
  { code: "BESI-8", name: "Besi Beton Polos 8 mm", item_type: "MATERIAL", uom: "KG", min_stock: 1000 },
  { code: "BESI-D13", name: "Besi Beton Ulir D13", item_type: "MATERIAL", uom: "KG", min_stock: 1500 },
  { code: "KAWAT-BDR", name: "Kawat Bendrat", item_type: "MATERIAL", uom: "KG", min_stock: 50 },
  { code: "MINYAK-BKS", name: "Minyak Bekisting", item_type: "MATERIAL", uom: "LTR", min_stock: 50 },
  { code: "SPACER", name: "Tahu Beton (Spacer)", item_type: "MATERIAL", uom: "BH", min_stock: 500 },
  // ---- barang jadi ----
  { code: "UDITCH-40", name: "U-Ditch Precast 40x40", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 10 },
  { code: "UDITCH-60", name: "U-Ditch Precast 60x60", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 20 },
  { code: "BUIS-60", name: "Buis Beton Ø60 cm", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 10 },
  { code: "BUIS-80", name: "Buis Beton Ø80 cm", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 10 },
  { code: "BUIS-100", name: "Buis Beton Ø100 cm", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 5 },
  { code: "PAVING-6", name: "Paving Block K300 tebal 6 cm", item_type: "FINISHED_GOOD", uom: "M2", min_stock: 50 },
  { code: "PAVING-8", name: "Paving Block K350 tebal 8 cm", item_type: "FINISHED_GOOD", uom: "M2", min_stock: 50 },
  { code: "KANSTEEN-30", name: "Kansteen Beton 30 cm", item_type: "FINISHED_GOOD", uom: "PCS", min_stock: 100 },
];

export const PARTIES = [
  { code: "SUP-01", name: "PT Semen Nusantara (demo)", party_type: "SUPPLIER", address: "Jl. Industri Semen No. 1" },
  { code: "SUP-02", name: "CV Agregat Jaya (demo)", party_type: "SUPPLIER", address: "Jl. Quarry Raya No. 7" },
  { code: "SUP-03", name: "PT Kimia Beton Perkasa (demo)", party_type: "SUPPLIER", address: "Kawasan Industri Blok C-12" },
  { code: "SUP-04", name: "PT Baja Mulia (demo)", party_type: "SUPPLIER", address: "Jl. Pelabuhan No. 88" },
  { code: "CUS-01", name: "PT Konstruksi Mandiri (demo)", party_type: "CUSTOMER", address: "Jl. Proyek Tol Km 12" },
  { code: "CUS-02", name: "CV Bangun Sejahtera (demo)", party_type: "CUSTOMER", address: "Jl. Raya Barat No. 5" },
  { code: "CUS-03", name: "Dinas PU Kabupaten (demo)", party_type: "CUSTOMER", address: "Jl. Pemerintahan No. 1" },
  { code: "CUS-04", name: "PT Jalan Raya Sentosa (demo)", party_type: "CUSTOMER", address: "Jl. Industri Timur No. 21" },
  { code: "MIT-01", name: "PT Mitra Beton (demo)", party_type: "BOTH", address: "Jl. Mitra No. 3" },
];

export const WAREHOUSES = [
  { code: "WH-M", name: "Gudang Material Utama", category: "MATERIAL" },
  { code: "WH-M2", name: "Gudang Agregat (Curah)", category: "MATERIAL" },
  { code: "WH-F", name: "Gudang Barang Jadi", category: "FINISHED_GOOD" },
];

export interface LocSeed {
  wh: string;
  code: string;
  name: string;
  type: string;
  parent?: string;
}

/** Pohon penempatan bebas per gudang (zona → rak, bin, area → blok). */
export const LOCATIONS: LocSeed[] = [
  { wh: "WH-M", code: "M-A", name: "Zona A (Semen & Aksesori)", type: "zona" },
  { wh: "WH-M", code: "M-A1", name: "Rak A1", type: "rak", parent: "M-A" },
  { wh: "WH-M", code: "M-A2", name: "Rak A2", type: "rak", parent: "M-A" },
  { wh: "WH-M", code: "M-A3", name: "Rak A3 (Spacer)", type: "rak", parent: "M-A" },
  { wh: "WH-M", code: "M-B", name: "Zona B (Besi)", type: "zona" },
  { wh: "WH-M", code: "M-B1", name: "Rak B1 (Polos & Kawat)", type: "rak", parent: "M-B" },
  { wh: "WH-M", code: "M-B2", name: "Rak B2 (Ulir)", type: "rak", parent: "M-B" },
  { wh: "WH-M", code: "M-C", name: "Zona C (Bahan Kimia)", type: "zona" },
  { wh: "WH-M", code: "M-C1", name: "Rak C1 (Aditif & Minyak)", type: "rak", parent: "M-C" },

  { wh: "WH-M2", code: "AG-P1", name: "Bin Pasir 1", type: "bin" },
  { wh: "WH-M2", code: "AG-P2", name: "Bin Pasir 2", type: "bin" },
  { wh: "WH-M2", code: "AG-B1", name: "Bin Batu 1-2", type: "bin" },
  { wh: "WH-M2", code: "AG-B2", name: "Bin Batu 0,5-1", type: "bin" },
  { wh: "WH-M2", code: "AG-FA", name: "Silo Fly Ash", type: "silo" },

  { wh: "WH-F", code: "F-1", name: "Area Precast 1", type: "area" },
  { wh: "WH-F", code: "F-1A", name: "Blok 1A", type: "blok", parent: "F-1" },
  { wh: "WH-F", code: "F-1B", name: "Blok 1B", type: "blok", parent: "F-1" },
  { wh: "WH-F", code: "F-1C", name: "Blok 1C", type: "blok", parent: "F-1" },
  { wh: "WH-F", code: "F-2", name: "Area Precast 2", type: "area" },
  { wh: "WH-F", code: "F-2A", name: "Blok 2A", type: "blok", parent: "F-2" },
  { wh: "WH-F", code: "F-2B", name: "Blok 2B", type: "blok", parent: "F-2" },
  { wh: "WH-F", code: "F-QC", name: "Area Karantina QC", type: "area" },
];

export interface UserSeed {
  username: string;
  name: string;
  role: string;
  dept: string;
  /** keanggotaan gudang */
  wh?: string[];
  headOfDept?: string;
  deputyOfDept?: string;
  headOfWh?: string;
  deputyOfWh?: string;
}

export const USERS: UserSeed[] = [
  { username: "admin", name: "Admin Sistem", role: "ADMIN", dept: "GDG" },
  { username: "manajemen", name: "Indra (Manajemen)", role: "MANAJEMEN", dept: "MGT" },

  { username: "staff_material", name: "Budi (Staff Gudang Material)", role: "STAFF_GUDANG_MATERIAL", dept: "GDG", wh: ["WH-M"] },
  { username: "staff_agregat", name: "Joko (Staff Gudang Agregat)", role: "STAFF_GUDANG_MATERIAL", dept: "GDG", wh: ["WH-M2"] },
  { username: "staff_bj", name: "Citra (Staff Gudang Barang Jadi)", role: "STAFF_GUDANG_BJ", dept: "GDG", wh: ["WH-F"] },

  { username: "staff_prod", name: "Dedi (Staff Produksi)", role: "STAFF_DEPT", dept: "PROD" },
  { username: "staff_prod2", name: "Rina (Staff Produksi)", role: "STAFF_DEPT", dept: "PROD" },

  { username: "kadep_prod", name: "Eko (Kepala Produksi)", role: "KEPALA_DEPT", dept: "PROD", headOfDept: "PROD" },
  { username: "kadep_gudang", name: "Fitri (Kepala Dept. Gudang)", role: "KEPALA_DEPT", dept: "GDG", headOfDept: "GDG" },
  { username: "wakil_kadep_gudang", name: "Surya (Wakil Kepala Dept. Gudang)", role: "KEPALA_DEPT", dept: "GDG", deputyOfDept: "GDG" },

  { username: "kagud_material", name: "Gita (Kepala Gudang Material)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-M"], headOfWh: "WH-M" },
  { username: "wakil_kagud_material", name: "Wawan (Wakil Kepala Gudang Material)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-M"], deputyOfWh: "WH-M" },
  { username: "kagud_agregat", name: "Yusuf (Kepala Gudang Agregat)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-M2"], headOfWh: "WH-M2" },
  { username: "kagud_bj", name: "Hadi (Kepala Gudang Barang Jadi)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-F"], headOfWh: "WH-F" },
];
