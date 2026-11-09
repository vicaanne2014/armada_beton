import { describe, it, expect, beforeEach } from 'vitest'
import {
  makeDb, seedFixture, rpc, rows, one, errOf, balance, statusOf, lineIds,
  receiveMaterial, requestMaterial, type Db, type Ids,
} from './harness'

let db: Db
let ids: Ids

beforeEach(async () => {
  db = await makeDb()
  ids = await seedFixture(db)
})

// ---- helper lokal ---------------------------------------------------------
async function poId(po: string) {
  return (await db.query<{ id: string }>(`select id from production_po where po_number=$1`, [po])).rows[0].id
}
/** Material masuk -> permintaan tervalidasi (PO jadi ACTIVE) -> penerimaan BJ tervalidasi sebanyak qty. */
async function fgStock(qty: number, po = 'PO-F-1') {
  await receiveMaterial(db, ids, { sj: 'SJ-F-' + po, qty: 1000 })
  const req = await requestMaterial(db, ids, { po, target: 1000, qty: 100 })
  const [l] = await lineIds(db, req)
  await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 100 }])
  const pid = await poId(po)
  const fg = await rpc.draft(db, ids.sgb, 'FG_RECEIPT',
    { warehouse_id: ids.whF, production_po_id: pid },
    [{ item_id: ids.precast, qty, location_id: ids.locFA }])
  await rpc.submit(db, ids.sgb, fg)
  await rpc.decide(db, ids.kdg, fg, 'APPROVE')
  await rpc.decide(db, ids.kgb, fg, 'APPROVE')
  return { pid, fg }
}
/** Pengiriman sampai menunggu validasi Kepala Gudang BJ. */
async function deliverUntilValidation(qty: number, loc = ids.locFA) {
  const doc = await rpc.draft(db, ids.sgb, 'DELIVERY_NOTE',
    { warehouse_id: ids.whF, customer_id: ids.cust, delivery_date: '2026-11-09' },
    [{ item_id: ids.precast, qty, location_id: loc }])
  await rpc.submit(db, ids.sgb, doc)
  await rpc.decide(db, ids.kdg, doc, 'APPROVE')
  return doc
}
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0].n)

// ===========================================================================
describe('alur bisnis end-to-end', () => {
  it('penerimaan → permintaan (alokasi dipecah) → penerimaan BJ → pengiriman', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000, loc: ids.locMA })
    await receiveMaterial(db, ids, { sj: 'SJ-2', qty: 200, loc: ids.locMB })
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)
    expect(await balance(db, ids.semen, ids.locMB)).toBe(200)

    const req = await requestMaterial(db, ids, { qty: 400, po: 'PO-PRD-1', target: 100 })
    expect(await statusOf(db, req)).toBe('MENUNGGU_VALIDASI')
    // stok belum berubah sebelum validasi (BR-11)
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)
    expect((await db.query<{ status: string }>(`select status from production_po where po_number='PO-PRD-1'`)).rows[0].status)
      .toBe('PENDING')

    const [l1] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [
      { line_id: l1, location_id: ids.locMA, qty: 300 },
      { line_id: l1, location_id: ids.locMB, qty: 100 },
    ])
    expect(await statusOf(db, req)).toBe('TERVALIDASI')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(700)
    expect(await balance(db, ids.semen, ids.locMB)).toBe(100)
    expect((await db.query<{ status: string }>(`select status from production_po where po_number='PO-PRD-1'`)).rows[0].status)
      .toBe('ACTIVE')

    // penerimaan barang jadi bertahap, melebihi target hanya memberi peringatan (BR-04)
    const pid = await poId('PO-PRD-1')
    const fg1 = await rpc.draft(db, ids.sgb, 'FG_RECEIPT', { warehouse_id: ids.whF, production_po_id: pid },
      [{ item_id: ids.precast, qty: 60, location_id: ids.locFA }])
    expect((await rpc.submit(db, ids.sgb, fg1)).warnings).toHaveLength(0)
    await rpc.decide(db, ids.kdg, fg1, 'APPROVE')
    await rpc.decide(db, ids.kgb, fg1, 'APPROVE')
    const fg2 = await rpc.draft(db, ids.sgb, 'FG_RECEIPT', { warehouse_id: ids.whF, production_po_id: pid },
      [{ item_id: ids.precast, qty: 50, location_id: ids.locFA }])
    const sub2 = await rpc.submit(db, ids.sgb, fg2)
    expect(sub2.warnings).toEqual([expect.objectContaining({ code: 'OVER_TARGET' })])
    await rpc.decide(db, ids.kdg, fg2, 'APPROVE')
    await rpc.decide(db, ids.kgb, fg2, 'APPROVE')
    expect(await balance(db, ids.precast, ids.locFA)).toBe(110)

    const prog = await one<{ received_qty: string; remaining_qty: string }>(
      db, ids.sdp, `select received_qty, remaining_qty from v_production_po_progress where id=$1`, [pid])
    expect(Number(prog.received_qty)).toBe(110)
    expect(Number(prog.remaining_qty)).toBe(-10)
    const taken = await rows<{ qty: string }>(db, ids.sdp, `select qty from v_po_material_taken where po_id=$1`, [pid])
    expect(Number(taken[0].qty)).toBe(400)

    // pengiriman: nomor surat jalan resmi terbit saat validasi
    const dn = await deliverUntilValidation(30)
    expect((await db.query<{ sj_number: string | null }>(`select sj_number from delivery_note where document_id=$1`, [dn])).rows[0].sj_number)
      .toBeNull()
    await rpc.decide(db, ids.kgb, dn, 'APPROVE')
    const sj = (await db.query<{ sj_number: string }>(`select sj_number from delivery_note where document_id=$1`, [dn])).rows[0].sj_number
    expect(sj).toMatch(/^SJK\/\d{4}\/\d{2}\/0001$/)
    expect(await balance(db, ids.precast, ids.locFA)).toBe(80)

    // invarian I4: ledger = saldo
    expect(await count(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('kartu stok: saldo akhir sama dengan stok saat ini', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const req = await requestMaterial(db, ids, { qty: 300 })
    const [l] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 300 }])
    const card = await rows<{ saldo: string; qty_in: string; qty_out: string }>(db, ids.kgm,
      `select * from stock_card($1,$2,'2000-01-01','2100-01-01')`, [ids.semen, ids.locMA])
    expect(card).toHaveLength(3)                       // saldo awal + 2 pergerakan
    expect(Number(card[0].saldo)).toBe(0)              // saldo awal periode
    expect(Number(card[card.length - 1].saldo)).toBe(await balance(db, ids.semen, ids.locMA))
    expect(Number(card[card.length - 1].saldo)).toBe(700)
    // periode setelah semua pergerakan: hanya saldo awal = stok saat ini
    const later = await rows<{ saldo: string }>(db, ids.kgm,
      `select * from stock_card($1,$2,'2090-01-01','2100-01-01')`, [ids.semen, ids.locMA])
    expect(later).toHaveLength(1)
    expect(Number(later[0].saldo)).toBe(700)
  })
})

// ===========================================================================
describe('stok tidak pernah negatif & atomik (I1, NFR-02)', () => {
  it('validasi dengan stok kurang gagal dan TIDAK mengubah apa pun', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const req = await requestMaterial(db, ids, { qty: 400 })
    const [l] = await lineIds(db, req)
    const movBefore = await count(`select count(*) n from stock_movement`)

    const e = await errOf(rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 400 }]))
    expect(e).toBe('INSUFFICIENT_STOCK')

    expect(await statusOf(db, req)).toBe('MENUNGGU_VALIDASI')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(100)
    expect(await count(`select count(*) n from stock_movement`)).toBe(movBefore)
    expect(await count(`select count(*) n from approval_step where document_id=$1 and decision='PENDING'`, [req])).toBe(1)
    expect(await count(`select count(*) n from document_line_alloc`)).toBe(0)
  })

  it('check constraint menjadi jaring terakhir', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const e = await errOf(db.query(`update stock_balance set qty = -1`))
    expect(e).toMatch(/check constraint/i)
  })

  it('alokasi wajib ada dan total harus sama dengan qty diminta', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const req = await requestMaterial(db, ids, { qty: 400 })
    const [l] = await lineIds(db, req)
    expect(await errOf(rpc.decide(db, ids.kgm, req, 'APPROVE'))).toBe('ALLOCATION_REQUIRED')
    expect(await errOf(rpc.decide(db, ids.kgm, req, 'APPROVE', null,
      [{ line_id: l, location_id: ids.locMA, qty: 300 }]))).toBe('ALLOCATION_MISMATCH')
    expect(await errOf(rpc.decide(db, ids.kgm, req, 'APPROVE', null,
      [{ line_id: l, location_id: ids.locFA, qty: 400 }]))).toBe('LOCATION_INVALID')   // lokasi gudang lain
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)
  })

  it('pemindahan menjaga total stok; stok kurang diblokir saat validasi', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const mk = async (qty: number) => {
      const t = await rpc.draft(db, ids.sgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
        [{ item_id: ids.semen, qty, location_id: ids.locMA, to_location_id: ids.locMB }])
      const s = await rpc.submit(db, ids.sgm, t)
      return { t, s }
    }
    const a = await mk(300)
    expect(a.s.status).toBe('MENUNGGU_VALIDASI')     // default tanpa approval Kepala Dept
    await rpc.decide(db, ids.kgm, a.t, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(700)
    expect(await balance(db, ids.semen, ids.locMB)).toBe(300)
    const total = Number((await db.query<{ s: string }>(`select sum(qty) s from stock_balance where item_id=$1`, [ids.semen])).rows[0].s)
    expect(total).toBe(1000)

    const b = await mk(5000)
    expect(b.s.warnings).toEqual([expect.objectContaining({ code: 'STOCK_LOW' })])   // peringatan saat submit
    expect(await errOf(rpc.decide(db, ids.kgm, b.t, 'APPROVE'))).toBe('INSUFFICIENT_STOCK')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(700)
  })
})

// ===========================================================================
describe('pemisahan tugas & otoritas (BR-05, BR-06)', () => {
  it('pembuat tidak boleh memutuskan dokumennya sendiri; tanpa approver lain dokumen tidak bisa disubmit', async () => {
    await db.query(`insert into role_permission(role_id, permission_id)
      select r.id, p.id from app_role r, permission p
       where r.code='KEPALA_GUDANG' and p.code='doc.create.stock_transfer'`)
    const t = await rpc.draft(db, ids.kgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA, to_location_id: ids.locMB }])
    // satu-satunya validator adalah pembuat -> NO_APPROVER, bukan macet diam-diam
    expect(await errOf(rpc.submit(db, ids.kgm, t))).toBe('NO_APPROVER')
    expect(await statusOf(db, t)).toBe('DRAFT')

    await db.query(`update warehouse set deputy_user_id=$1 where id=$2`, [ids.kgb, ids.whM])
    await rpc.submit(db, ids.kgm, t)
    expect(await errOf(rpc.decide(db, ids.kgm, t, 'APPROVE'))).toBe('SELF_APPROVAL')
  })

  it('hanya pihak yang berwenang pada langkahnya yang bisa memutuskan', async () => {
    const doc = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: 'SJ-9', receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 10, location_id: ids.locMA }])
    await rpc.submit(db, ids.sgm, doc)
    expect(await errOf(rpc.decide(db, ids.sgm, doc, 'APPROVE'))).toBe('FORBIDDEN')                 // tanpa permission
    expect(await errOf(rpc.decide(db, ids.kdp, doc, 'APPROVE'))).toBe('NOT_AUTHORIZED_FOR_STEP')   // Kepala Dept lain
    expect(await errOf(rpc.decide(db, ids.mgr, doc, 'APPROVE'))).toBe('FORBIDDEN')
    await rpc.decide(db, ids.kdg, doc, 'APPROVE')
    expect(await errOf(rpc.decide(db, ids.kgb, doc, 'APPROVE'))).toBe('NOT_WAREHOUSE_HEAD')        // BR-06
    expect(await errOf(rpc.decide(db, ids.kdg, doc, 'APPROVE'))).toBe('NOT_WAREHOUSE_HEAD')
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')
    expect(await errOf(rpc.decide(db, ids.kgm, doc, 'APPROVE'))).toBe('INVALID_STATE')             // klik ganda aman
    expect(await balance(db, ids.semen, ids.locMA)).toBe(10)                                        // tidak diposting dua kali
  })

  it('tolak/kembalikan wajib alasan; dokumen dikembalikan bisa direvisi dan disubmit ulang', async () => {
    const doc = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: 'SJ-R', receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 10, location_id: ids.locMA }])
    const s1 = await rpc.submit(db, ids.sgm, doc)
    expect(await errOf(rpc.decide(db, ids.kdg, doc, 'RETURN', '  '))).toBe('REASON_REQUIRED')
    await rpc.decide(db, ids.kdg, doc, 'RETURN', 'qty salah')
    expect(await statusOf(db, doc)).toBe('DIKEMBALIKAN')
    expect(await count(`select count(*) n from notification where user_id=$1 and kind='RETURNED'`, [ids.sgm])).toBe(1)

    expect(await errOf(rpc.draft(db, ids.sdp, 'MATERIAL_RECEIPT', {}, [], doc))).toBe('FORBIDDEN')
    await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: 'SJ-R', receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 25, location_id: ids.locMA }], doc)
    expect(await statusOf(db, doc)).toBe('DRAFT')
    const s2 = await rpc.submit(db, ids.sgm, doc)
    expect(s2.doc_no).toBe(s1.doc_no)                                   // nomor tidak berubah
    expect((await db.query<{ cycle: number }>(`select cycle from document where id=$1`, [doc])).rows[0].cycle).toBe(2)
    expect(await count(`select count(*) n from approval_step where document_id=$1`, [doc])).toBeGreaterThanOrEqual(4)   // riwayat tetap ada

    await rpc.decide(db, ids.kdg, doc, 'APPROVE')
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(25)
    expect(await errOf(rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT', {}, [], doc))).toBe('INVALID_STATE')   // terkunci
  })

  it('draft yang belum pernah disubmit boleh dihapus; yang sudah pernah tidak', async () => {
    const d1 = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA }])
    await one(db, ids.sgm, `select public.delete_draft($1)`, [d1])
    expect(await count(`select count(*) n from document where id=$1`, [d1])).toBe(0)
  })
})

// ===========================================================================
describe('imutabilitas & jalur tulis tunggal (I2, I3, I7)', () => {
  it('ledger append-only, bahkan untuk superuser; dokumen tervalidasi terkunci', async () => {
    const doc = await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    expect(await errOf(db.query(`update stock_movement set qty_in = 1`))).toBe('IMMUTABLE_TABLE')
    expect(await errOf(db.query(`delete from stock_movement`))).toBe('IMMUTABLE_TABLE')
    expect(await errOf(db.query(`truncate stock_movement`))).toBe('IMMUTABLE_TABLE')
    expect(await errOf(db.query(`update document set note='x' where id=$1`, [doc]))).toBe('DOCUMENT_LOCKED')
    expect(await errOf(db.query(`delete from document where id=$1`, [doc]))).toBe('DOCUMENT_LOCKED')
    expect(await errOf(db.query(
      `insert into document_line(document_id,line_no,item_id,qty,location_id) values ($1,9,$2,1,$3)`,
      [doc, ids.semen, ids.locMA]))).toBe('DOCUMENT_LOCKED')
  })

  it('user login tidak bisa menulis stok/dokumen langsung atau memanggil fungsi private', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    for (const sql of [
      `update stock_balance set qty = 9999`,
      `insert into stock_movement(warehouse_id,item_id,location_id,qty_in,document_id,doc_type,doc_no,posted_by)
         select warehouse_id,item_id,location_id,5,(select id from document limit 1),'X','X',(select id from app_user limit 1) from stock_balance limit 1`,
      `insert into document(doc_type,warehouse_id,department_id,created_by) select 'MATERIAL_RECEIPT',id,(select id from department limit 1),(select id from app_user limit 1) from warehouse limit 1`,
      `update document set status='TERVALIDASI'`,
      `update approval_step set decision='APPROVED'`,
      `update approval_flow_config set is_active=false`,
      `select private.apply_stock_deltas(gen_random_uuid(),'X','X',gen_random_uuid(),gen_random_uuid(),'[]'::jsonb)`,
      `select private.next_number('SJK','209911')`,
    ]) {
      expect(await errOf(rows(db, ids.sgm, sql))).toMatch(/permission denied/i)
    }
    expect(await balance(db, ids.semen, ids.locMA)).toBe(100)
  })

  it('anon tidak membaca apa pun', async () => {
    expect(await errOf(rows(db, 'anon', `select * from item`))).toMatch(/permission denied/i)
    expect(await errOf(rows(db, 'anon', `select * from stock_balance`))).toMatch(/permission denied/i)
    expect(await errOf(rows(db, 'anon', `select public.submit_document(gen_random_uuid())`))).toMatch(/permission denied/i)
    expect(await errOf(rows(db, 'anon', `select * from v_production_po_progress`))).toMatch(/permission denied/i)
  })

  it('FK komposit: satuan harus sejenis dengan item; satuan dan tipe terkunci setelah ada pergerakan', async () => {
    expect(await errOf(db.query(
      `insert into item(code,name,item_type,uom_id) values ('X','X','MATERIAL',$1)`, [ids.uomPcs])))
      .toMatch(/foreign key/i)
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const sak = (await db.query<{ id: string }>(
      `insert into uom(code,name,uom_type) values ('SAK','Sak','MATERIAL') returning id`)).rows[0].id
    expect(await errOf(rows(db, ids.admin, `update item set uom_id=$1 where id=$2`, [sak, ids.semen])))
      .toBe('ITEM_UOM_LOCKED')
  })
})

// ===========================================================================
describe('konfigurasi approval (BR-12, BR-13)', () => {
  it('langkah validasi Kepala Gudang tidak bisa dimatikan; hanya admin yang boleh mengatur', async () => {
    expect(await errOf(db.query(
      `update approval_flow_config set is_active=false where doc_type='MATERIAL_RECEIPT' and step_role='KEPALA_GUDANG'`)))
      .toMatch(/check constraint/i)
    expect(await errOf(rows(db, ids.admin, `select public.set_flow_step_active('MATERIAL_RECEIPT',2,false)`)))
      .toBe('FLOW_STEP_LOCKED')
    expect(await errOf(rows(db, ids.sgm, `select public.set_flow_step_active('MATERIAL_RECEIPT',1,false)`)))
      .toBe('FORBIDDEN')
  })

  it('perubahan konfigurasi tidak memengaruhi dokumen yang sedang berjalan', async () => {
    const mk = (sj: string) => rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: sj, receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 10, location_id: ids.locMA }])
    const a = await mk('SJ-A')
    expect((await rpc.submit(db, ids.sgm, a)).status).toBe('MENUNGGU_APPROVAL')

    await one(db, ids.admin, `select public.set_flow_step_active('MATERIAL_RECEIPT',1,false)`)
    // dokumen berjalan tetap butuh Kepala Dept (snapshot)
    expect((await rpc.decide(db, ids.kdg, a, 'APPROVE')).status).toBe('MENUNGGU_VALIDASI')
    // dokumen baru langsung ke validasi gudang
    const b = await mk('SJ-B')
    expect((await rpc.submit(db, ids.sgm, b)).status).toBe('MENUNGGU_VALIDASI')
    // semuanya tercatat di audit
    expect(await count(`select count(*) n from audit_log where entity_type='approval_flow_config'`)).toBeGreaterThan(0)
  })
})

// ===========================================================================
describe('aturan dokumen', () => {
  it('item harus sejenis dengan kategori gudang (BR-15)', async () => {
    const d = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: 'SJ-X', receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.precast, qty: 1, location_id: ids.locMA }])
    expect(await errOf(rpc.submit(db, ids.sgm, d))).toBe('ITEM_WAREHOUSE_MISMATCH')
  })

  it('field wajib dan penempatan diperiksa saat submit', async () => {
    const d = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA }])
    expect(await errOf(rpc.submit(db, ids.sgm, d))).toBe('MISSING_FIELD')
    const e = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: 'SJ-Z', receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locFA }])
    expect(await errOf(rpc.submit(db, ids.sgm, e))).toBe('LOCATION_INVALID')
    const f = await rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT', { warehouse_id: ids.whM,
      sj_number: 'SJ-Y', receipt_date: '2026-11-09', sender_party_id: ids.sup }, [])
    expect(await errOf(rpc.submit(db, ids.sgm, f))).toBe('NO_LINES')
    expect(await errOf(rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT', { warehouse_id: ids.whF }, []))).toBe('FORBIDDEN')
  })

  it('nomor surat jalan masuk unik per pengirim dan dibebaskan saat ditolak (BR-08)', async () => {
    const mk = (sj: string) => rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: sj, receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA }])
    const a = await mk('SJ-DUP')
    expect(await errOf(mk('SJ-DUP'))).toBe('DUPLICATE_SJ')
    expect(await errOf(mk('sj-dup'))).toBe('DUPLICATE_SJ')               // tidak peka huruf besar
    await rpc.submit(db, ids.sgm, a)
    await rpc.decide(db, ids.kdg, a, 'REJECT', 'dokumen salah')
    expect(await statusOf(db, a)).toBe('DITOLAK')
    await mk('SJ-DUP')                                                    // boleh dipakai ulang
  })

  it('penempatan berisi stok tidak bisa dinonaktifkan sebelum dipindah (BR-09)', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    expect(await errOf(rows(db, ids.admin, `update location set is_active=false where id=$1`, [ids.locMA])))
      .toBe('LOCATION_HAS_STOCK')
    const t = await rpc.draft(db, ids.sgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 100, location_id: ids.locMA, to_location_id: ids.locMB }])
    await rpc.submit(db, ids.sgm, t)
    await rpc.decide(db, ids.kgm, t, 'APPROVE')
    await rows(db, ids.admin, `update location set is_active=false where id=$1`, [ids.locMA])   // kini boleh
    expect(await count(`select count(*) n from location where id=$1 and not is_active`, [ids.locMA])).toBe(1)
  })

  it('pohon penempatan: siklus ditolak, induk harus di gudang yang sama', async () => {
    const child = (await db.query<{ id: string }>(
      `insert into location(warehouse_id,code,name,parent_id) values ($1,'M-A1','A1',$2) returning id`,
      [ids.whM, ids.locMA])).rows[0].id
    expect(await errOf(db.query(`update location set parent_id=$1 where id=$2`, [child, ids.locMA]))).toBe('LOCATION_CYCLE')
    expect(await errOf(db.query(
      `insert into location(warehouse_id,code,name,parent_id) values ($1,'X','X',$2)`, [ids.whF, ids.locMA])))
      .toMatch(/foreign key/i)
  })
})

// ===========================================================================
describe('PO produksi (BR-03, BR-04)', () => {
  it('PO lahir dari permintaan; penerimaan BJ hanya untuk PO yang sudah ACTIVE', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const req = await requestMaterial(db, ids, { po: 'PO-A', target: 50, qty: 10 })
    const pid = await poId('PO-A')
    const mkFg = () => rpc.draft(db, ids.sgb, 'FG_RECEIPT', { warehouse_id: ids.whF, production_po_id: pid },
      [{ item_id: ids.precast, qty: 5, location_id: ids.locFA }])
    expect(await errOf(rpc.submit(db, ids.sgb, await mkFg()))).toBe('PO_NOT_ACTIVE')   // permintaan belum divalidasi
    const [l] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 10 }])
    await rpc.submit(db, ids.sgb, await mkFg())
  })

  it('nomor PO yang sama dipakai ulang bila produk dan target sama; berbeda → PO_MISMATCH', async () => {
    await requestMaterial(db, ids, { po: 'PO-B', target: 100, qty: 10 })
    await requestMaterial(db, ids, { po: 'PO-B', target: 100, qty: 20 })
    expect(await count(`select count(*) n from production_po where po_number='PO-B'`)).toBe(1)
    const bad = await rpc.draft(db, ids.sdp, 'MATERIAL_REQUEST',
      { warehouse_id: ids.whM, po_number: 'PO-B', finished_item_id: ids.precast, target_qty: 999 },
      [{ item_id: ids.semen, qty: 1 }])
    expect(await errOf(rpc.submit(db, ids.sdp, bad))).toBe('PO_MISMATCH')
  })

  it('permintaan ditolak tidak meninggalkan PO aktif', async () => {
    const doc = await rpc.draft(db, ids.sdp, 'MATERIAL_REQUEST',
      { warehouse_id: ids.whM, po_number: 'PO-C', finished_item_id: ids.precast, target_qty: 10 },
      [{ item_id: ids.semen, qty: 1 }])
    await rpc.submit(db, ids.sdp, doc)
    await rpc.decide(db, ids.kdp, doc, 'REJECT', 'tidak perlu')
    expect((await db.query<{ status: string }>(`select status from production_po where po_number='PO-C'`)).rows[0].status).toBe('PENDING')
  })
})

// ===========================================================================
describe('penomoran surat jalan keluar tanpa celah (NFR-09)', () => {
  it('berurutan; validasi yang gagal tidak menghabiskan nomor', async () => {
    await fgStock(100)
    const d1 = await deliverUntilValidation(10)
    await rpc.decide(db, ids.kgb, d1, 'APPROVE')
    const d2 = await deliverUntilValidation(10)
    await rpc.decide(db, ids.kgb, d2, 'APPROVE')
    const big = await deliverUntilValidation(9999)
    expect(await errOf(rpc.decide(db, ids.kgb, big, 'APPROVE'))).toBe('INSUFFICIENT_STOCK')
    const d3 = await deliverUntilValidation(5)
    await rpc.decide(db, ids.kgb, d3, 'APPROVE')
    const nums = (await db.query<{ sj_number: string }>(
      `select sj_number from delivery_note where sj_number is not null order by sj_number`)).rows.map((r) => r.sj_number.slice(-4))
    expect(nums).toEqual(['0001', '0002', '0003'])
    expect(await balance(db, ids.precast, ids.locFA)).toBe(75)
  })

  it('pengiriman hanya untuk customer', async () => {
    await fgStock(10)
    const doc = await rpc.draft(db, ids.sgb, 'DELIVERY_NOTE',
      { warehouse_id: ids.whF, customer_id: ids.sup, delivery_date: '2026-11-09' },
      [{ item_id: ids.precast, qty: 1, location_id: ids.locFA }])
    expect(await errOf(rpc.submit(db, ids.sgb, doc))).toBe('PARTY_INVALID')
  })
})

// ===========================================================================
describe('transaksi pembalik (BR-07)', () => {
  it('membalik pengiriman: stok kembali, nomor SJ asli tetap, tidak bisa dibalik dua kali', async () => {
    await fgStock(100)
    const dn = await deliverUntilValidation(40)
    await rpc.decide(db, ids.kgb, dn, 'APPROVE')
    expect(await balance(db, ids.precast, ids.locFA)).toBe(60)

    expect(await errOf(rpc.reversal(db, ids.sgb, dn, ''))).toBe('REASON_REQUIRED')
    expect(await errOf(rpc.reversal(db, ids.sdp, dn, 'salah'))).toBe('FORBIDDEN')
    const rev = await rpc.reversal(db, ids.sgb, dn, 'barang batal dikirim')
    expect(await errOf(rpc.reversal(db, ids.sgb, dn, 'lagi'))).toBe('ALREADY_REVERSED')
    expect((await rpc.submit(db, ids.sgb, rev)).doc_no).toMatch(/^REV\//)
    await rpc.decide(db, ids.kdg, rev, 'APPROVE')
    await rpc.decide(db, ids.kgb, rev, 'APPROVE')
    expect(await balance(db, ids.precast, ids.locFA)).toBe(100)
    expect(await errOf(rpc.reversal(db, ids.sgb, rev, 'balik pembalik'))).toBe('INVALID_STATE')
    expect(await count(`select count(*) n from delivery_note where sj_number is not null`)).toBe(1)
    expect(await count(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('pembalik penerimaan terblokir bila material sudah terpakai', async () => {
    const r = await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const req = await requestMaterial(db, ids, { qty: 100 })
    const [l] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 100 }])
    const rev = await rpc.reversal(db, ids.sgm, r, 'salah catat')
    await rpc.submit(db, ids.sgm, rev)
    await rpc.decide(db, ids.kdg, rev, 'APPROVE')
    expect(await errOf(rpc.decide(db, ids.kgm, rev, 'APPROVE'))).toBe('INSUFFICIENT_STOCK')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(0)
  })

  it('membalik permintaan material mengembalikan stok ke penempatan alokasi asal; PO progress menyesuaikan', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 500 })
    const req = await requestMaterial(db, ids, { po: 'PO-R', qty: 200, target: 10 })
    const [l] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: l, location_id: ids.locMA, qty: 200 }])
    expect(await balance(db, ids.semen, ids.locMA)).toBe(300)
    const rev = await rpc.reversal(db, ids.sgm, req, 'salah minta')
    await rpc.submit(db, ids.sgm, rev)
    await rpc.decide(db, ids.kdp, rev, 'APPROVE')           // approval oleh Kepala Dept dokumen asal
    await rpc.decide(db, ids.kgm, rev, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(500)
    const taken = await rows<{ qty: string }>(db, ids.kgm, `select qty from v_po_material_taken`)
    expect(Number(taken[0].qty)).toBe(0)
  })
})

// ===========================================================================
describe('hak akses data (RLS)', () => {
  it('stok dan dokumen dibatasi per gudang dan peran', async () => {
    await fgStock(50)   // mengisi gudang material dan barang jadi

    const stockOf = async (uid: string) =>
      (await rows<{ warehouse_code: string }>(db, uid, `select warehouse_code from v_stock`)).map((r) => r.warehouse_code)
    expect(new Set(await stockOf(ids.sgm))).toEqual(new Set(['WH-M']))
    expect(new Set(await stockOf(ids.sgb))).toEqual(new Set(['WH-F']))
    expect(new Set(await stockOf(ids.kgb))).toEqual(new Set(['WH-F']))
    expect(await stockOf(ids.sdp)).toEqual([])                                  // staff dept tidak melihat stok
    expect(new Set(await stockOf(ids.kdp))).toEqual(new Set(['WH-M', 'WH-F']))  // stock.read.all
    expect(new Set(await stockOf(ids.mgr))).toEqual(new Set(['WH-M', 'WH-F']))

    const docsOf = async (uid: string) =>
      (await rows<{ doc_type: string }>(db, uid, `select doc_type from document`)).map((r) => r.doc_type)
    expect(new Set(await docsOf(ids.sdp))).toEqual(new Set(['MATERIAL_REQUEST']))   // hanya miliknya
    expect(new Set(await docsOf(ids.sgb))).toEqual(new Set(['FG_RECEIPT']))
    expect((await docsOf(ids.mgr)).length).toBeGreaterThanOrEqual(3)
    // kdp (Kepala Dept Produksi) melihat dokumen departemennya saja
    expect(new Set(await docsOf(ids.kdp))).toEqual(new Set(['MATERIAL_REQUEST']))
    // Manajemen hanya baca
    expect(await errOf(rpc.submit(db, ids.mgr, (await db.query<{ id: string }>(`select id from document limit 1`)).rows[0].id)))
      .toBe('FORBIDDEN')
  })

  it('inbox hanya berisi dokumen yang memang menunggu keputusan user tersebut', async () => {
    const doc = await rpc.draft(db, ids.sdp, 'MATERIAL_REQUEST',
      { warehouse_id: ids.whM, po_number: 'PO-I', finished_item_id: ids.precast, target_qty: 10 },
      [{ item_id: ids.semen, qty: 1 }])
    await rpc.submit(db, ids.sdp, doc)
    const inbox = async (u: string) => (await rows(db, u, `select id from v_inbox`)).length
    expect([await inbox(ids.kdp), await inbox(ids.kgm), await inbox(ids.sdp), await inbox(ids.kdg)]).toEqual([1, 0, 0, 0])
    expect(await count(`select count(*) n from notification where user_id=$1 and kind='APPROVAL_NEEDED'`, [ids.kdp])).toBe(1)
    await rpc.decide(db, ids.kdp, doc, 'APPROVE')
    expect([await inbox(ids.kdp), await inbox(ids.kgm)]).toEqual([0, 1])
    expect(await count(`select count(*) n from notification where user_id=$1 and kind='VALIDATION_NEEDED'`, [ids.kgm])).toBe(1)
  })

  it('master data: hanya admin; penempatan juga Kepala Gudang pada gudangnya', async () => {
    expect(await errOf(rows(db, ids.sgm, `insert into item(code,name,item_type,uom_id) values ('N','N','MATERIAL',$1)`, [ids.uomKg])))
      .toMatch(/row-level security/i)
    await rows(db, ids.admin, `insert into item(code,name,item_type,uom_id) values ('N','N','MATERIAL',$1)`, [ids.uomKg])
    await rows(db, ids.kgm, `insert into location(warehouse_id,code,name) values ($1,'M-C','C')`, [ids.whM])
    expect(await errOf(rows(db, ids.kgm, `insert into location(warehouse_id,code,name) values ($1,'F-C','C')`, [ids.whF])))
      .toMatch(/row-level security/i)
  })
})

// ===========================================================================
describe('audit trail (FR-22)', () => {
  it('perubahan master tercatat, tidak bisa diubah, hanya dibaca yang berhak', async () => {
    await rows(db, ids.admin, `update item set name='Semen Portland' where id=$1`, [ids.semen])
    const a = await rows<{ action: string; actor_id: string; before: { name: string }; after: { name: string } }>(
      db, ids.admin, `select action, actor_id, before, after from audit_log where entity_type='item' and action='UPDATE'`)
    expect(a).toHaveLength(1)
    expect(a[0].actor_id).toBe(ids.admin)
    expect(a[0].before.name).toBe('SEMEN')
    expect(a[0].after.name).toBe('Semen Portland')
    expect(await errOf(db.query(`update audit_log set action='X'`))).toBe('IMMUTABLE_TABLE')
    expect(await errOf(db.query(`delete from audit_log`))).toBe('IMMUTABLE_TABLE')
    expect(await rows(db, ids.sgm, `select * from audit_log`)).toHaveLength(0)
  })

  it('keputusan approval tercatat di audit dan riwayat langkah', async () => {
    const doc = await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 10 })
    const acts = (await rows<{ action: string }>(db, ids.admin,
      `select action from audit_log where entity_type='document' and entity_id=$1 order by id`, [doc])).map((r) => r.action)
    expect(acts).toEqual(['SUBMIT', 'DECISION_APPROVE', 'DECISION_APPROVE'])
    const steps = await rows<{ approver_id: string; decision: string }>(db, ids.kgm,
      `select approver_id, decision from approval_step where document_id=$1 order by step_order`, [doc])
    expect(steps.map((s) => s.decision)).toEqual(['APPROVED', 'APPROVED'])
    expect(steps.map((s) => s.approver_id)).toEqual([ids.kdg, ids.kgm])
  })
})
