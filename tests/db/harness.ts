import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

// Stub minimal lingkungan Supabase: schema auth, auth.uid(), role anon/authenticated/service_role
// dan default privilege seperti di project Supabase.
const BOOTSTRAP = `
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export type Db = PGlite
export type Ids = Record<string, string>

export async function makeDb(): Promise<Db> {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  }
  return db
}

/** Jalankan fn sebagai user login (role authenticated + JWT sub), atau 'anon', atau null = superuser. */
export async function withUser<T>(db: Db, uid: string | null | 'anon', fn: () => Promise<T>): Promise<T> {
  if (uid === null) return fn()
  const claims = uid === 'anon' ? { role: 'anon' } : { sub: uid, role: 'authenticated' }
  await db.exec(
    `select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${
      uid === 'anon' ? 'anon' : 'authenticated'
    };`,
  )
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

export async function rows<T = Record<string, unknown>>(
  db: Db, uid: string | null | 'anon', sql: string, params: unknown[] = [],
): Promise<T[]> {
  return withUser(db, uid, async () => (await db.query<T>(sql, params)).rows)
}

export async function one<T = Record<string, unknown>>(
  db: Db, uid: string | null | 'anon', sql: string, params: unknown[] = [],
): Promise<T> {
  const r = await rows<T>(db, uid, sql, params)
  if (r.length === 0) throw new Error('no rows: ' + sql)
  return r[0]
}

/** Kembalikan pesan error (kode domain) dari sebuah panggilan yang seharusnya gagal. */
export async function errOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected an error but the call succeeded')
}

// ---------------------------------------------------------------------------
// Fixture: 2 departemen, 2 gudang, 9 user, master item, dsb.
// ---------------------------------------------------------------------------
export async function seedFixture(db: Db): Promise<Ids> {
  const ids: Ids = {}
  const id = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0].id

  ids.deptProd = await id(`insert into department(code,name) values ('PROD','Produksi') returning id`)
  ids.deptGdg = await id(`insert into department(code,name) values ('GDG','Gudang') returning id`)

  const role = async (code: string) => id(`select id from app_role where code=$1`, [code])
  const mkUser = async (key: string, roleCode: string, dept: string | null) => {
    const uid = await id(`insert into auth.users(email) values ($1) returning id`, [`${key}@wms.local`])
    await db.query(
      `insert into app_user(id, username, full_name, role_id, department_id) values ($1,$2,$3,$4,$5)`,
      [uid, key, key.toUpperCase(), await role(roleCode), dept],
    )
    ids[key] = uid
  }
  await mkUser('admin', 'ADMIN', ids.deptGdg)
  await mkUser('sgm', 'STAFF_GUDANG_MATERIAL', ids.deptGdg)
  await mkUser('sgb', 'STAFF_GUDANG_BJ', ids.deptGdg)
  await mkUser('sdp', 'STAFF_DEPT', ids.deptProd)
  await mkUser('kdp', 'KEPALA_DEPT', ids.deptProd)
  await mkUser('kdg', 'KEPALA_DEPT', ids.deptGdg)
  await mkUser('kgm', 'KEPALA_GUDANG', ids.deptGdg)
  await mkUser('kgb', 'KEPALA_GUDANG', ids.deptGdg)
  await mkUser('mgr', 'MANAJEMEN', null)

  await db.query(`update department set head_user_id=$1 where id=$2`, [ids.kdp, ids.deptProd])
  await db.query(`update department set head_user_id=$1 where id=$2`, [ids.kdg, ids.deptGdg])

  ids.whM = await id(
    `insert into warehouse(code,name,category,head_user_id) values ('WH-M','Gudang Material','MATERIAL',$1) returning id`,
    [ids.kgm])
  ids.whF = await id(
    `insert into warehouse(code,name,category,head_user_id) values ('WH-F','Gudang Barang Jadi','FINISHED_GOOD',$1) returning id`,
    [ids.kgb])
  await db.query(`insert into user_warehouse(user_id, warehouse_id) values ($1,$2),($3,$4)`,
    [ids.sgm, ids.whM, ids.sgb, ids.whF])

  const loc = (wh: string, code: string) =>
    id(`insert into location(warehouse_id, code, name, type_label) values ($1,$2,$2,'rak') returning id`, [wh, code])
  ids.locMA = await loc(ids.whM, 'M-A')
  ids.locMB = await loc(ids.whM, 'M-B')
  ids.locFA = await loc(ids.whF, 'F-A')
  ids.locFB = await loc(ids.whF, 'F-B')

  ids.uomKg = await id(`insert into uom(code,name,uom_type) values ('KG','Kilogram','MATERIAL') returning id`)
  ids.uomPcs = await id(`insert into uom(code,name,uom_type) values ('PCS','Pcs','FINISHED_GOOD') returning id`)
  const item = (code: string, type: string, uom: string) =>
    id(`insert into item(code,name,item_type,uom_id) values ($1,$1,$2,$3) returning id`, [code, type, uom])
  ids.semen = await item('SEMEN', 'MATERIAL', ids.uomKg)
  ids.pasir = await item('PASIR', 'MATERIAL', ids.uomKg)
  ids.precast = await item('PRECAST', 'FINISHED_GOOD', ids.uomPcs)
  ids.sup = await id(`insert into party(code,name,party_type) values ('SUP1','Supplier 1','SUPPLIER') returning id`)
  ids.cust = await id(`insert into party(code,name,party_type) values ('CUST1','Customer 1','CUSTOMER') returning id`)
  return ids
}

// ---------------------------------------------------------------------------
// Helper alur dokumen (memanggil RPC sebagai user tertentu)
// ---------------------------------------------------------------------------
export const rpc = {
  draft: async (db: Db, uid: string, type: string, header: object, lines: object[], docId: string | null = null) =>
    (await one<{ save_draft: string }>(db, uid, `select public.save_draft($1,$2,$3::jsonb) as save_draft`,
      [type, docId, JSON.stringify({ header, lines })])).save_draft,
  submit: async (db: Db, uid: string, docId: string) =>
    (await one<{ r: { status: string; doc_no: string; warnings: unknown[] } }>(db, uid,
      `select public.submit_document($1) as r`, [docId])).r,
  decide: async (db: Db, uid: string, docId: string, decision: string, reason: string | null = null, alloc: object[] | null = null) =>
    (await one<{ r: { status: string } }>(db, uid, `select public.decide_document($1,$2,$3,$4::jsonb) as r`,
      [docId, decision, reason, alloc ? JSON.stringify(alloc) : null])).r,
  reversal: async (db: Db, uid: string, docId: string, reason: string) =>
    (await one<{ id: string }>(db, uid, `select public.create_reversal($1,$2) as id`, [docId, reason])).id,
}

export const balance = async (db: Db, item: string, loc: string): Promise<number> => {
  const r = await db.query<{ qty: string }>(`select qty from stock_balance where item_id=$1 and location_id=$2`, [item, loc])
  return r.rows.length ? Number(r.rows[0].qty) : 0
}

export const statusOf = async (db: Db, docId: string): Promise<string> =>
  (await db.query<{ status: string }>(`select status from document where id=$1`, [docId])).rows[0].status

/** Penerimaan material lengkap sampai tervalidasi (sgm -> kdg -> kgm). */
export async function receiveMaterial(
  db: Db, ids: Ids, opts: { sj: string; item?: string; loc?: string; qty?: number },
): Promise<string> {
  const doc = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
    { warehouse_id: ids.whM, sj_number: opts.sj, receipt_date: '2026-11-09', sender_party_id: ids.sup, po_number: 'PO-BELI-1' },
    [{ item_id: opts.item ?? ids.semen, qty: opts.qty ?? 1000, location_id: opts.loc ?? ids.locMA }])
  await rpc.submit(db, ids.sgm, doc)
  await rpc.decide(db, ids.kdg, doc, 'APPROVE')
  await rpc.decide(db, ids.kgm, doc, 'APPROVE')
  return doc
}

/** Permintaan material: sdp membuat, kdp approve; berhenti di MENUNGGU_VALIDASI. */
export async function requestMaterial(
  db: Db, ids: Ids, opts: { po?: string; target?: number; qty?: number; item?: string } = {},
): Promise<string> {
  const doc = await rpc.draft(db, ids.sdp, 'MATERIAL_REQUEST',
    { warehouse_id: ids.whM, po_number: opts.po ?? 'PO-PRD-1', finished_item_id: ids.precast, target_qty: opts.target ?? 100 },
    [{ item_id: opts.item ?? ids.semen, qty: opts.qty ?? 400 }])
  await rpc.submit(db, ids.sdp, doc)
  await rpc.decide(db, ids.kdp, doc, 'APPROVE')
  return doc
}

export async function lineIds(db: Db, docId: string): Promise<string[]> {
  return (await db.query<{ id: string }>(`select id from document_line where document_id=$1 order by line_no`, [docId]))
    .rows.map((r) => r.id)
}
