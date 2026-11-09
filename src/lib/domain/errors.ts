export interface DbErrorLike {
  message: string;
  details?: string | null;
  code?: string;
}

export interface DomainError {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Sesi berakhir. Silakan login kembali.",
  FORBIDDEN: "Anda tidak memiliki akses untuk aksi ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  INVALID_INPUT: "Input tidak valid. Periksa kembali isian Anda.",
  INVALID_STATE: "Dokumen sudah berubah status (mungkin sudah diputuskan orang lain). Muat ulang halaman.",
  INVALID_DOC_TYPE: "Jenis dokumen tidak dikenal.",
  INSUFFICIENT_STOCK: "Stok di penempatan tidak cukup.",
  DUPLICATE_SJ: "Nomor surat jalan masuk ini sudah tercatat untuk pengirim yang sama.",
  DUPLICATE: "Data dengan kode/nomor yang sama sudah ada.",
  IN_USE: "Data ini masih dipakai data lain sehingga tidak bisa diubah/dihapus.",
  SELF_APPROVAL: "Pembuat dokumen tidak boleh menyetujui atau memvalidasi dokumennya sendiri.",
  NOT_AUTHORIZED_FOR_STEP: "Anda bukan Kepala Departemen (atau deputi) yang berwenang atas dokumen ini.",
  NOT_WAREHOUSE_HEAD: "Anda bukan Kepala Gudang (atau deputi) untuk gudang dokumen ini.",
  REASON_REQUIRED: "Alasan wajib diisi.",
  NO_APPROVER:
    "Tidak ada approver yang bisa memproses dokumen ini (Kepala/deputi belum ditetapkan, atau hanya pembuat sendiri). Hubungi Admin.",
  NO_DEPARTMENT: "Akun Anda belum memiliki departemen. Hubungi Admin.",
  NO_LINES: "Dokumen harus memiliki minimal satu baris item.",
  MISSING_FIELD: "Ada isian wajib yang belum lengkap.",
  WAREHOUSE_NOT_FOUND: "Gudang tidak ditemukan atau tidak aktif.",
  WAREHOUSE_INACTIVE: "Gudang tidak aktif.",
  WAREHOUSE_CATEGORY_MISMATCH: "Kategori gudang tidak sesuai dengan jenis dokumen.",
  WAREHOUSE_CATEGORY_LOCKED: "Kategori gudang tidak bisa diubah karena sudah ada dokumen.",
  ITEM_WAREHOUSE_MISMATCH:
    "Jenis item tidak sesuai dengan kategori gudang (material hanya di gudang material, barang jadi hanya di gudang barang jadi).",
  LOCATION_INVALID: "Penempatan tidak valid (tidak aktif atau bukan milik gudang dokumen).",
  LOCATION_REQUIRED: "Setiap baris wajib memiliki penempatan.",
  LOCATION_HAS_STOCK: "Penempatan masih berisi stok. Pindahkan stoknya terlebih dahulu.",
  LOCATION_CYCLE: "Penempatan tidak bisa dijadikan turunan dari dirinya sendiri.",
  TRANSFER_SAME_LOCATION: "Penempatan asal dan tujuan tidak boleh sama.",
  ALLOCATION_REQUIRED: "Penempatan sumber material belum ditentukan.",
  ALLOCATION_INVALID: "Alokasi penempatan tidak valid.",
  ALLOCATION_MISMATCH: "Total alokasi per material harus sama dengan jumlah yang diminta.",
  PO_MISMATCH: "Nomor PO produksi ini sudah ada dengan produk atau target yang berbeda.",
  PO_NOT_ACTIVE:
    "PO produksi ini belum memiliki permintaan material yang tervalidasi, sehingga belum bisa menerima barang jadi.",
  PO_ITEM_MISMATCH: "Item barang jadi harus sama dengan produk target PO produksi.",
  PO_ITEM_INVALID: "Produk target harus berupa item barang jadi yang aktif.",
  PARTY_INVALID: "Pihak tujuan harus berupa customer yang aktif.",
  ALREADY_REVERSED: "Dokumen ini sudah memiliki transaksi pembalik.",
  DOCUMENT_LOCKED: "Dokumen sudah terkunci dan tidak bisa diubah.",
  IMMUTABLE_TABLE: "Data ini tidak boleh diubah.",
  FLOW_STEP_LOCKED: "Langkah ini tidak dapat diubah. Validasi Kepala Gudang selalu wajib.",
  ITEM_UOM_LOCKED: "Satuan item tidak bisa diganti setelah ada pergerakan stok.",
  ITEM_TYPE_LOCKED: "Jenis item tidak bisa diganti setelah ada pergerakan stok.",
  ITEM_HAS_STOCK: "Item masih memiliki stok sehingga tidak bisa dinonaktifkan.",
  UOM_IN_USE: "Satuan masih dipakai item aktif.",
  UOM_TYPE_LOCKED: "Jenis satuan tidak bisa diganti karena sudah dipakai item.",
  LOCATION_UNDER_COUNT:
    "Penempatan sedang dihitung (stock opname). Transaksi pada penempatan ini tertahan sampai opname selesai atau dibatalkan.",
  OPNAME_UNCOUNTED: "Masih ada baris yang belum dihitung. Isi hitungan fisik (0 bila kosong) untuk semua baris.",
  OPNAME_STALE:
    "Stok sistem berubah sejak sesi opname dibuka, sehingga selisih tidak lagi valid. Batalkan sesi ini dan buka sesi baru.",
  OPNAME_SCOPE_EMPTY: "Penempatan yang dipilih tidak valid untuk gudang ini.",
  ATTACHMENT_LIMIT: "Lampiran maksimal 5 berkas per dokumen.",
  ATTACHMENT_INVALID: "Lampiran tidak valid. Gunakan JPG, PNG, WEBP, atau PDF maksimal 5 MB pada surat jalan masuk.",
};

export function mapDbError(err: DbErrorLike): DomainError {
  const msg = err.message ?? "";
  let detail: Record<string, unknown> | undefined;
  if (err.details) {
    try {
      detail = JSON.parse(err.details);
    } catch {
      /* details bukan JSON */
    }
  }
  // Kode domain: pesan = KODE (huruf besar + underscore)
  if (/^[A-Z][A-Z0-9_]+$/.test(msg)) {
    return { code: msg, message: MESSAGES[msg] ?? `Terjadi kesalahan (${msg}).`, detail };
  }
  if (err.code === "23505") return { code: "DUPLICATE", message: MESSAGES.DUPLICATE };
  if (err.code === "23503") return { code: "IN_USE", message: MESSAGES.IN_USE };
  if (err.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return { code: "FORBIDDEN", message: MESSAGES.FORBIDDEN };
  }
  if (["23514", "23502", "22P02", "22007", "22003"].includes(err.code ?? "")) {
    return { code: "INVALID_INPUT", message: MESSAGES.INVALID_INPUT };
  }
  return { code: "UNKNOWN", message: "Terjadi kesalahan tak terduga. Coba lagi atau hubungi Admin." };
}
