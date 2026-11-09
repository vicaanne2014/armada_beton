/**
 * Seed data demo. Idempotent: aman dijalankan berulang.
 *   npm run seed        (membaca .env.local)
 * Membuat departemen, gudang + pohon penempatan, satuan, item, pihak luar, dan 9 user demo
 * (satu per peran) lengkap dengan penugasan kepala gudang/departemen.
 * Memakai service_role key: HANYA dijalankan dari mesin Anda, tidak pernah dari browser.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD ?? "Ganti-Saya-123!";
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di .env.local");
  process.exit(1);
}
if (password.length < 10) {
  console.error("SEED_PASSWORD minimal 10 karakter");
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${what}: ${error?.message ?? "tidak ada data"}`);
  return data as NonNullable<T>;
}

async function main() {
  // ---------- departemen ----------
  const depts = await must(
    db
      .from("department")
      .upsert(
        [
          { code: "PROD", name: "Produksi" },
          { code: "GDG", name: "Gudang" },
          { code: "MGT", name: "Manajemen" },
        ],
        { onConflict: "code" },
      )
      .select("id, code"),
    "department",
  );
  const dept = Object.fromEntries(depts.map((d) => [d.code, d.id]));

  // ---------- satuan & item ----------
  const uoms = await must(
    db
      .from("uom")
      .upsert(
        [
          { code: "KG", name: "Kilogram", uom_type: "MATERIAL" },
          { code: "SAK", name: "Sak", uom_type: "MATERIAL" },
          { code: "LTR", name: "Liter", uom_type: "MATERIAL" },
          { code: "PCS", name: "Pcs", uom_type: "FINISHED_GOOD" },
        ],
        { onConflict: "code" },
      )
      .select("id, code"),
    "uom",
  );
  const uom = Object.fromEntries(uoms.map((u) => [u.code, u.id]));

  await must(
    db
      .from("item")
      .upsert(
        [
          { code: "SEMEN", name: "Semen Portland", item_type: "MATERIAL", uom_id: uom.KG, min_stock: 5000 },
          { code: "PASIR", name: "Pasir Beton", item_type: "MATERIAL", uom_id: uom.KG, min_stock: 20000 },
          { code: "BATU", name: "Batu Split 1-2", item_type: "MATERIAL", uom_id: uom.KG, min_stock: 20000 },
          { code: "ADITIF", name: "Aditif Beton", item_type: "MATERIAL", uom_id: uom.LTR, min_stock: 200 },
          { code: "BESI-8", name: "Besi Beton 8 mm", item_type: "MATERIAL", uom_id: uom.KG, min_stock: 1000 },
          { code: "U-DITCH-60", name: "U-Ditch Precast 60x60", item_type: "FINISHED_GOOD", uom_id: uom.PCS, min_stock: 20 },
          { code: "PAVING-6", name: "Paving Block K300 6 cm", item_type: "FINISHED_GOOD", uom_id: uom.PCS, min_stock: 500 },
          { code: "BUIS-80", name: "Buis Beton 80 cm", item_type: "FINISHED_GOOD", uom_id: uom.PCS, min_stock: 10 },
        ],
        { onConflict: "code" },
      )
      .select("id"),
    "item",
  );

  await must(
    db
      .from("party")
      .upsert(
        [
          { code: "SUP-01", name: "PT Semen Nusantara (contoh)", party_type: "SUPPLIER", address: "Jl. Industri No. 1" },
          { code: "SUP-02", name: "CV Agregat Jaya (contoh)", party_type: "SUPPLIER", address: "Jl. Quarry No. 7" },
          { code: "CUS-01", name: "PT Konstruksi Mandiri (contoh)", party_type: "CUSTOMER", address: "Jl. Proyek No. 12" },
          { code: "CUS-02", name: "CV Bangun Sejahtera (contoh)", party_type: "CUSTOMER", address: "Jl. Raya Barat No. 5" },
        ],
        { onConflict: "code" },
      )
      .select("id"),
    "party",
  );

  // ---------- gudang ----------
  const whs = await must(
    db
      .from("warehouse")
      .upsert(
        [
          { code: "WH-M", name: "Gudang Material", category: "MATERIAL" },
          { code: "WH-F", name: "Gudang Barang Jadi", category: "FINISHED_GOOD" },
        ],
        { onConflict: "code" },
      )
      .select("id, code"),
    "warehouse",
  );
  const wh = Object.fromEntries(whs.map((w) => [w.code, w.id]));

  // ---------- pohon penempatan (induk dibuat dulu) ----------
  const tree: Array<{ wh: string; code: string; name: string; type: string; parent?: string }> = [
    { wh: "WH-M", code: "M-A", name: "Zona A", type: "zona" },
    { wh: "WH-M", code: "M-A1", name: "Rak A1", type: "rak", parent: "M-A" },
    { wh: "WH-M", code: "M-A2", name: "Rak A2", type: "rak", parent: "M-A" },
    { wh: "WH-M", code: "M-B", name: "Zona B (Silo & Tumpukan)", type: "zona" },
    { wh: "WH-F", code: "F-1", name: "Area 1", type: "area" },
    { wh: "WH-F", code: "F-1A", name: "Blok 1A", type: "blok", parent: "F-1" },
    { wh: "WH-F", code: "F-1B", name: "Blok 1B", type: "blok", parent: "F-1" },
    { wh: "WH-F", code: "F-2", name: "Area 2", type: "area" },
  ];
  const locId = new Map<string, string>();
  for (const l of tree) {
    const row = await must(
      db
        .from("location")
        .upsert(
          {
            warehouse_id: wh[l.wh],
            code: l.code,
            name: l.name,
            type_label: l.type,
            parent_id: l.parent ? locId.get(`${l.wh}:${l.parent}`) : null,
          },
          { onConflict: "warehouse_id,code" },
        )
        .select("id")
        .single(),
      `location ${l.code}`,
    );
    locId.set(`${l.wh}:${l.code}`, row.id);
  }

  // ---------- user demo ----------
  const roles = await must(db.from("app_role").select("id, code"), "app_role");
  const role = Object.fromEntries(roles.map((r) => [r.code, r.id]));

  const demo = [
    { username: "admin", name: "Admin Sistem", role: "ADMIN", dept: "GDG", wh: [] as string[] },
    { username: "staff_material", name: "Budi (Staff Gudang Material)", role: "STAFF_GUDANG_MATERIAL", dept: "GDG", wh: ["WH-M"] },
    { username: "staff_bj", name: "Citra (Staff Gudang Barang Jadi)", role: "STAFF_GUDANG_BJ", dept: "GDG", wh: ["WH-F"] },
    { username: "staff_prod", name: "Dedi (Staff Produksi)", role: "STAFF_DEPT", dept: "PROD", wh: [] },
    { username: "kadep_prod", name: "Eko (Kepala Produksi)", role: "KEPALA_DEPT", dept: "PROD", wh: [] },
    { username: "kadep_gudang", name: "Fitri (Kepala Dept. Gudang)", role: "KEPALA_DEPT", dept: "GDG", wh: [] },
    { username: "kagud_material", name: "Gita (Kepala Gudang Material)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-M"] },
    { username: "kagud_bj", name: "Hadi (Kepala Gudang Barang Jadi)", role: "KEPALA_GUDANG", dept: "GDG", wh: ["WH-F"] },
    { username: "manajemen", name: "Indra (Manajemen)", role: "MANAJEMEN", dept: "MGT", wh: [] },
  ];

  const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const byEmail = new Map((existing?.users ?? []).map((u) => [u.email, u.id]));
  const uid: Record<string, string> = {};

  for (const u of demo) {
    const email = `${u.username}@wms.local`;
    let id = byEmail.get(email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${u.username}: ${error?.message}`);
      id = data.user.id;
      console.log(`+ user ${u.username}`);
    }
    uid[u.username] = id;
    await must(
      db
        .from("app_user")
        .upsert(
          { id, username: u.username, full_name: u.name, role_id: role[u.role], department_id: dept[u.dept], is_active: true },
          { onConflict: "id" },
        )
        .select("id"),
      `app_user ${u.username}`,
    );
    for (const code of u.wh) {
      await must(
        db.from("user_warehouse").upsert({ user_id: id, warehouse_id: wh[code] }, { onConflict: "user_id,warehouse_id" }).select("id"),
        `user_warehouse ${u.username}`,
      );
    }
  }

  // ---------- kepala ----------
  await must(db.from("department").update({ head_user_id: uid.kadep_prod }).eq("id", dept.PROD).select("id"), "head PROD");
  await must(db.from("department").update({ head_user_id: uid.kadep_gudang }).eq("id", dept.GDG).select("id"), "head GDG");
  await must(db.from("warehouse").update({ head_user_id: uid.kagud_material }).eq("id", wh["WH-M"]).select("id"), "head WH-M");
  await must(db.from("warehouse").update({ head_user_id: uid.kagud_bj }).eq("id", wh["WH-F"]).select("id"), "head WH-F");

  console.log("\nSeed selesai. Login dengan username berikut (password = SEED_PASSWORD):");
  for (const u of demo) console.log(`  ${u.username.padEnd(16)} ${u.name}`);
  console.log("\nGanti password semua user demo sebelum dipakai di produksi.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
