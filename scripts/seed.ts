/**
 * Seeder.
 *   npm run seed         master data batching plant + 14 user demo           (idempotent)
 *   npm run seed:demo    di atas + skenario transaksi demo satu bulan operasi (sekali jalan)
 *
 * Memakai service_role key: HANYA dijalankan dari mesin Anda, tidak pernah dari browser/Vercel.
 * Transaksi demo dijalankan lewat RPC sebagai tiap user (login), persis seperti aplikasi.
 */
import { runSeed } from "./seed/run";
import { supabaseApi } from "./seed/supabase-api";
import { USERS } from "./seed/data";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.SEED_PASSWORD ?? "Ganti-Saya-123!";
const demo = process.argv.includes("--demo");

if (!url || !serviceKey || !publishableKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di .env.local",
  );
  process.exit(1);
}
if (password.length < 10) {
  console.error("SEED_PASSWORD minimal 10 karakter");
  process.exit(1);
}

async function main() {
  const api = supabaseApi({ url: url!, serviceKey: serviceKey!, publishableKey: publishableKey!, password });
  const summary = await runSeed(api, { demo, log: (m) => console.log(`  ${m}`) });

  console.log(`\nSelesai. ${summary.master.items} item, ${summary.master.locations} penempatan, ${summary.master.users} pengguna.`);
  if (summary.demo) {
    if (summary.demo.skipped) console.log(`Skenario demo dilewati (sudah ada ${summary.demo.documents} dokumen).`);
    else {
      console.log(`Skenario demo: ${summary.demo.documents} dokumen.`);
      for (const w of summary.demo.warnings) console.log(`  peringatan sengaja pada ${w.doc}: ${w.code}`);
    }
  } else {
    console.log("Tambahkan data transaksi contoh dengan: npm run seed:demo");
  }
  console.log("\nLogin (password = SEED_PASSWORD):");
  for (const u of USERS) console.log(`  ${u.username.padEnd(22)} ${u.name}`);
  console.log("\nGanti password semua user demo sebelum dipakai di produksi.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
