# WMS Batching Plant Beton

Aplikasi warehouse management untuk dua jenis gudang (material dan barang jadi) di pabrik batching plant beton.
Next.js (App Router) + Supabase (Postgres, Auth, RLS).

Cakupan: master data, penerimaan material, permintaan material + PO produksi, pemindahan penempatan, penerimaan barang jadi,
pengiriman + surat jalan PDF, transaksi pembalik, **stock opname**, **lampiran surat jalan masuk**, approval/validasi bertingkat,
notifikasi in-app, kartu stok, dashboard per user, laporan Excel/PDF, dan audit trail.

Dokumen desain: [`docs/PRD - WMS Batching Plant Beton.md`](docs/PRD%20-%20WMS%20Batching%20Plant%20Beton.md) dan
[`docs/Technical Logic - WMS Batching Plant Beton.md`](docs/Technical%20Logic%20-%20WMS%20Batching%20Plant%20Beton.md).

## Cara kerja inti

- Stok disimpan **per item per penempatan** (pohon lokasi bebas per gudang) dan **hanya berubah saat dokumen divalidasi
  Kepala Gudang**. Draft dan dokumen yang menunggu approval tidak mengubah stok.
- Alur dokumen: Draft → Menunggu Approval (Kepala Departemen) → Menunggu Validasi (Kepala Gudang) → Tervalidasi.
  Dikembalikan (revisi) dan Ditolak wajib beralasan.
- Seluruh aturan bisnis tinggal di **database** (fungsi RPC `SECURITY DEFINER`), bukan di Next.js. Next.js hanya UI,
  validasi form, PDF/Excel, dan pemetaan error. Akibatnya aturan tetap berlaku walau UI dilewati.
- Ledger `stock_movement` append-only; koreksi dokumen tervalidasi lewat **transaksi pembalik** yang juga diapprove.

## Menjalankan

Prasyarat: Node 22+, sebuah project Supabase.

```bash
npm install
cp .env.example .env.local          # isi URL, publishable key, service role key
```

1. **Terapkan migrasi** di `supabase/migrations/` ke project Supabase, **berurutan** (4 file):
   `supabase link --project-ref <ref>` lalu `supabase db push`, atau tempel isinya ke SQL Editor satu per satu.
2. **Seed**: `npm run seed` untuk master data + 14 user demo, atau **`npm run seed:demo`** untuk sekaligus mengisi
   skenario transaksi satu bulan operasi (lihat bagian Seeder). Keduanya membutuhkan `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` di `.env.local`.
3. `npm run dev`, buka http://localhost:3000, login memakai username (mis. `admin`) dan `SEED_PASSWORD`.

Ganti password semua user demo sebelum dipakai sungguhan. Login memakai **username**; Supabase Auth menyimpannya sebagai
email sintetis `<username>@wms.local`.

## Seeder

`npm run seed` idempotent (upsert berdasarkan kode; aman diulang). `npm run seed:demo` menambahkan transaksi **sekali saja**:
bila sudah ada dokumen, skenario dilewati, karena ledger tidak bisa direset dari aplikasi. Untuk mengulang dari nol, buat
project Supabase baru (atau kosongkan skema sebagai superuser di SQL Editor).

Transaksi demo tidak ditulis langsung ke tabel. Seeder login sebagai tiap user dan memanggil RPC yang sama dengan aplikasi,
sehingga approval, pemisahan tugas, penomoran, ledger, dan audit terbentuk secara sah.

**Master data (batching plant precast):** 3 gudang (Material Utama, Agregat Curah, Barang Jadi) dengan 22 penempatan berpohon;
20 item (12 material: semen, pasir, batu split, fly ash, aditif, besi, kawat, minyak bekisting, spacer; 8 barang jadi: U-ditch, buis,
paving, kansteen); satuan material dan barang jadi terpisah; 4 supplier dan 5 customer (bertanda "(demo)"); 3 departemen.

**Pengguna demo (14)**, password = `SEED_PASSWORD`:

| Username | Peran | Catatan |
|---|---|---|
| `admin` | Admin Sistem | master, user, alur approval, audit |
| `manajemen` | Manajemen | baca saja, semua gudang |
| `staff_material` | Staff Gudang Material | gudang WH-M |
| `staff_agregat` | Staff Gudang Material | gudang WH-M2 |
| `staff_bj` | Staff Gudang Barang Jadi | gudang WH-F |
| `staff_prod`, `staff_prod2` | Staff Departemen Produksi | tanpa akses gudang |
| `kadep_prod` | Kepala Departemen Produksi | menyetujui dokumen Produksi |
| `kadep_gudang` | Kepala Departemen Gudang | menyetujui dokumen staff gudang |
| `wakil_kadep_gudang` | Deputi Kepala Dept. Gudang | pengganti `kadep_gudang` |
| `kagud_material` | Kepala Gudang | WH-M |
| `wakil_kagud_material` | Deputi Kepala Gudang | pengganti untuk WH-M |
| `kagud_agregat` | Kepala Gudang | WH-M2 |
| `kagud_bj` | Kepala Gudang | WH-F |

**Skenario demo (32 dokumen)** dengan sebaran status: 17 tervalidasi, 4 menunggu validasi, 4 menunggu approval, 2 dikembalikan,
2 ditolak, 3 draft. Yang bisa ditelusuri:

- **Stok awal** dari 6 penerimaan material (surat jalan + referensi PO pembelian); satu divalidasi oleh **deputi**.
- **PO-PRD-2611-001** (U-Ditch 60, target 200): 2 permintaan material dari 2 gudang (satu material dipecah dari 2 penempatan),
  penerimaan barang jadi bertahap 80 + 70 (50 lagi menunggu approval), 1 pengiriman.
- **PO-PRD-2611-002** (Buis 80, target 150): target tercapai; 3 pengiriman, satu **dibalik** (barang dikembalikan customer);
  penerimaan kelebihan 10 pcs memicu peringatan melebihi target.
- **Surat jalan keluar** SJK/…/0001–0003 sudah terbit; satu pengiriman menunggu validasi, satu draft.
- **Opname** Bin Pasir 1 selesai (selisih −2 m³ diposting); opname **Blok 1C sedang berjalan** dan mengunci penempatan itu:
  penerimaan 10 buis ke Blok 1C yang menunggu approval akan ditolak validasinya sampai opname selesai.
- **Inbox**: tiap kepala dan deputi punya 2 dokumen menunggu; dokumen dikembalikan/ditolak membawa alasan.
- **Peringatan stok**: permintaan 5.000 sak semen memicu peringatan saat submit; semen, aditif SP, dan pasir di bawah minimum.
- **Lampiran** foto surat jalan pada 1 dokumen dikembalikan dan 1 draft.

### Mencoba alur lengkap

1. `staff_material`: Penerimaan Material → isi surat jalan, pengirim, item, penempatan → **Simpan & Ajukan**.
2. `kadep_gudang`: Inbox Approval → **Setujui**. Lalu `kagud_material`: **Validasi** (stok bertambah).
3. `staff_prod`: Permintaan Material → isi No. PO Produksi, produk target, material → Ajukan.
4. `kadep_prod`: Setujui. `kagud_material`: pilih penempatan sumber (atau **Isi otomatis**) → Validasi.
5. `staff_bj`: Penerimaan Barang Jadi → pilih PO produksi → Ajukan; `kadep_gudang` setujui; `kagud_bj` validasi.
6. `staff_bj`: Pengiriman → Ajukan → disetujui → divalidasi; surat jalan PDF terbit dengan nomor `SJK/YYYY/MM/NNNN`.

## Pengujian

```bash
npm test            # 72 test: aturan bisnis + skenario seeder di Postgres (PGlite) + pemeriksaan berkas, tanpa Supabase/Docker
npm run typecheck
npm run build
```

`npm test` menjalankan migrasi SQL yang sama pada Postgres in-process, dengan stub `auth.uid()` dan role
`anon`/`authenticated`, sehingga RLS, grant, trigger, dan RPC ikut teruji. Yang diuji antara lain: stok tidak pernah negatif
dan rollback utuh saat gagal, pemisahan tugas, ledger tidak bisa diubah (termasuk oleh superuser), penomoran surat jalan tanpa
celah, transaksi pembalik, dan pembatasan data per gudang/peran.

## Struktur

```
supabase/migrations/   skema, RLS, fungsi RPC, data referensi (peran, permission, alur approval)
src/app/(app)/         halaman: dashboard, docs/[type], approvals, stock, po, reports, master, audit, admin
src/app/actions/       Server Actions (memanggil RPC dengan JWT user)
src/app/api/           PDF surat jalan, export laporan Excel/PDF
src/lib/               klien Supabase, sesi, registry jenis dokumen, peta error, laporan
tests/db/              test invarian database
scripts/seed.ts        data demo
```

## Catatan keamanan

- Semua tabel ber-RLS; tulis ke dokumen/stok hanya lewat RPC. `service_role` key hanya dipakai di server untuk membuat
  user (Admin API) dan script seed; **jangan** diberi awalan `NEXT_PUBLIC_`.
- Otorisasi dibaca dari tabel (bukan `user_metadata`), jadi perubahan peran langsung berlaku.
- Langkah validasi Kepala Gudang tidak bisa dimatikan dari konfigurasi approval.

## Stock opname

Menu **Stock Opname** (staff gudang membuka dan menghitung, Kepala Departemen menyetujui, Kepala Gudang memvalidasi).

1. **Buka sesi**: pilih gudang dan penempatan yang dihitung (opsi: sertakan penempatan di bawahnya). Stok sistem disalin
   sebagai snapshot dan penempatan tersebut **dikunci**.
2. **Hitung**: isi hitungan fisik tiap baris (0 adalah isian yang sah). Item yang ditemukan tetapi belum tercatat di
   sistem ditambah lewat "Item temuan".
3. **Ajukan**: semua baris wajib terisi. Selisih diposting ke ledger (`doc_type = STOCK_OPNAME`) hanya saat divalidasi.
4. Kunci lepas otomatis saat sesi tervalidasi, ditolak, atau dibatalkan. Bila dikembalikan untuk revisi, kunci tetap.

Kunci bersifat **lunak**: dokumen lain boleh dibuat sebagai draft, tetapi tidak bisa diajukan (dan yang sudah diajukan tidak
bisa divalidasi) pada penempatan terkunci. Satu penempatan hanya bisa berada di satu sesi. Bila saldo ternyata berubah sejak
snapshot, validasi ditolak (`OPNAME_STALE`) dan sesi harus diulang. Hasil opname tervalidasi dikoreksi lewat transaksi pembalik.

## Lampiran surat jalan masuk

Foto/PDF (JPG, PNG, WEBP, PDF; maks. 5 MB; maks. 5 berkas) dilampirkan pada **penerimaan material** setelah draft disimpan,
dan terkunci setelah diajukan (dibuka lagi bila dikembalikan). Berkas disimpan di bucket privat `attachments` (dibuat oleh
migrasi 0004) dan dilayani lewat signed URL 60 detik setelah hak akses dokumen diperiksa. Isi berkas diperiksa dari byte awalnya,
bukan dari nama atau tipe yang dikirim klien. Fitur ini memerlukan `SUPABASE_SERVICE_ROLE_KEY` di server.

## Notifikasi

Hanya **in-app**: halaman Notifikasi dan badge di menu (jumlah belum dibaca, serta jumlah dokumen di Inbox Approval). Muncul untuk
dokumen yang menunggu approval/validasi dan untuk hasil keputusan ke pembuat. Belum realtime; badge diperbarui saat halaman dimuat.
Email/WhatsApp belum ada (dirancang sebagai konsumen tabel `notification`).

## Keterbatasan

- Tidak ada reservasi stok: peringatan saat submit tidak menahan stok; validasi yang memblokir bila stok kurang.
- PDF surat jalan dirender saat diminta (tanpa cache di Storage). Daftar dokumen dibatasi 100 baris terbaru per jenis.
- Sentry belum dipasang.
- Konkurensi dua koneksi belum diuji otomatis (PGlite satu koneksi); penguncian `FOR UPDATE` didesain untuk itu.
- **UI belum diuji end-to-end terhadap Supabase sungguhan.** Yang teruji: logika database (55 test), typecheck, lint, build, dan
  proteksi login di runtime. Seeder terbukti di Postgres lokal; adapter Supabase-nya belum dijalankan. Upload/unduh lampiran dan Storage belum pernah dijalankan.
