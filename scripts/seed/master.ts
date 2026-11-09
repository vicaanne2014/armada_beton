import { DEPARTMENTS, ITEMS, LOCATIONS, PARTIES, UOMS, USERS, WAREHOUSES } from "./data";
import type { Refs, Row, SeedApi } from "./types";

const byCode = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.code as string, r.id as string]));

/** Master data + user demo. Idempotent: aman dijalankan berulang (upsert berdasarkan kode). */
export async function seedMaster(api: SeedApi, log: (m: string) => void): Promise<Refs> {
  const dept = byCode(await api.upsert("department", DEPARTMENTS, ["code"]));
  const uom = byCode(await api.upsert("uom", UOMS, ["code"]));
  log(`departemen ${Object.keys(dept).length}, satuan ${Object.keys(uom).length}`);

  const item = byCode(
    await api.upsert(
      "item",
      ITEMS.map((i) => ({
        code: i.code,
        name: i.name,
        item_type: i.item_type,
        uom_id: uom[i.uom],
        min_stock: i.min_stock ?? null,
      })),
      ["code"],
    ),
  );
  const party = byCode(await api.upsert("party", PARTIES, ["code"]));
  const wh = byCode(await api.upsert("warehouse", WAREHOUSES, ["code"]));
  log(`item ${Object.keys(item).length}, pihak luar ${Object.keys(party).length}, gudang ${Object.keys(wh).length}`);

  // induk harus ada sebelum anak: LOCATIONS sudah berurutan
  const loc: Record<string, string> = {};
  for (const l of LOCATIONS) {
    const [row] = await api.upsert(
      "location",
      [
        {
          warehouse_id: wh[l.wh],
          code: l.code,
          name: l.name,
          type_label: l.type,
          parent_id: l.parent ? loc[l.parent] : null,
        },
      ],
      ["warehouse_id", "code"],
    );
    loc[l.code] = row.id as string;
  }
  log(`penempatan ${Object.keys(loc).length}`);

  const roles = byCode(await api.select(null, "app_role"));
  const user: Record<string, string> = {};
  for (const u of USERS) {
    const id = await api.ensureAuthUser(u.username);
    user[u.username] = id;
    await api.upsert(
      "app_user",
      [{ id, username: u.username, full_name: u.name, role_id: roles[u.role], department_id: dept[u.dept], is_active: true }],
      ["id"],
    );
    for (const w of u.wh ?? []) {
      await api.upsert("user_warehouse", [{ user_id: id, warehouse_id: wh[w] }], ["user_id", "warehouse_id"]);
    }
  }

  // kepala dan deputi (otoritas keputusan approval/validasi)
  for (const u of USERS) {
    if (u.headOfDept) await api.update("department", { head_user_id: user[u.username] }, { code: u.headOfDept });
    if (u.deputyOfDept) await api.update("department", { deputy_user_id: user[u.username] }, { code: u.deputyOfDept });
    if (u.headOfWh) await api.update("warehouse", { head_user_id: user[u.username] }, { code: u.headOfWh });
    if (u.deputyOfWh) await api.update("warehouse", { deputy_user_id: user[u.username] }, { code: u.deputyOfWh });
  }
  log(`pengguna ${USERS.length}`);

  return { user, item, loc, party, wh };
}
