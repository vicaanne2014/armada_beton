export type Row = Record<string, unknown>;

/**
 * Antarmuka tipis yang dibutuhkan seeder. Ada dua implementasi:
 *  - supabase-api.ts : terhadap project Supabase sungguhan (service role + login per user)
 *  - tests/db/seed-api.ts : terhadap Postgres lokal (PGlite), dipakai untuk membuktikan skenario
 * Transaksi SELALU lewat rpc() sebagai user yang berwenang, persis seperti aplikasi, sehingga seluruh
 * aturan bisnis (approval, pemisahan tugas, stok tidak negatif, kunci opname) ikut berlaku pada data demo.
 */
export interface SeedApi {
  /** Membuat akun login bila belum ada; mengembalikan id. */
  ensureAuthUser(username: string): Promise<string>;
  /** Upsert (service). Mengembalikan baris hasil. */
  upsert(table: string, rows: Row[], onConflict: string[]): Promise<Row[]>;
  update(table: string, patch: Row, match: Row): Promise<void>;
  /** Baca. as = username (RLS berlaku) atau null (service). */
  select(as: string | null, table: string, match?: Row): Promise<Row[]>;
  /** Panggil RPC publik sebagai user. Melempar Error(kode domain) bila aturan bisnis menolak. */
  rpc(as: string, fn: string, args: Row): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Unggah lampiran (opsional: butuh Storage). Bila tidak ada, skenario melewatinya. */
  uploadAttachment?(as: string, docId: string, fileName: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface Refs {
  user: Record<string, string>;
  item: Record<string, string>;
  loc: Record<string, string>;
  party: Record<string, string>;
  wh: Record<string, string>;
}

export interface SeedOptions {
  /** true = jalankan juga skenario transaksi demo */
  demo: boolean;
  log?: (msg: string) => void;
}

export interface SeedSummary {
  master: { users: number; items: number; locations: number };
  demo: null | {
    skipped: boolean;
    documents: number;
    warnings: Array<{ doc: string; code: string }>;
  };
}
