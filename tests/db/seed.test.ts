import { describe, it, expect, beforeAll } from 'vitest'
import { makeDb, rows, errOf, type Db } from './harness'
import { pgliteSeedApi } from './seed-api'
import { runSeed } from '../../scripts/seed/run'
import { USERS, ITEMS, LOCATIONS, WAREHOUSES } from '../../scripts/seed/data'
import type { SeedSummary } from '../../scripts/seed/types'

let db: Db
let api: ReturnType<typeof pgliteSeedApi>
let summary: SeedSummary
const logs: string[] = []

const uid = async (u: string) => (await db.query<{ id: string }>(`select id from app_user where username=$1`, [u])).rows[0].id
const num = async (sql: string, p: unknown[] = []) => Number((await db.query<{ n: string }>(sql, p)).rows[0].n)
const qty = async (item: string, loc: string) =>
  Number((await db.query<{ qty: string }>(
    `select b.qty from stock_balance b join item i on i.id=b.item_id join location l on l.id=b.location_id
      where i.code=$1 and l.code=$2`, [item, loc])).rows[0]?.qty ?? 0)
const inbox = async (u: string) => (await rows(db, await uid(u), `select id from v_inbox`)).length

beforeAll(async () => {
  db = await makeDb()
  api = pgliteSeedApi(db)
  summary = await runSeed(api, { demo: true, log: (m) => logs.push(m) })
})

describe('seeder: master data batching plant', () => {
  it('membuat master lengkap sesuai definisi', async () => {
    expect(summary.master).toEqual({ users: USERS.length, items: ITEMS.length, locations: LOCATIONS.length })
    expect(await num(`select count(*) n from warehouse`)).toBe(WAREHOUSES.length)
    expect(await num(`select count(*) n from item where item_type='MATERIAL'`)).toBe(ITEMS.filter((i) => i.item_type === 'MATERIAL').length)
    expect(await num(`select count(*) n from item where item_type='FINISHED_GOOD'`)).toBe(ITEMS.filter((i) => i.item_type === 'FINISHED_GOOD').length)
    expect(await num(`select count(*) n from party where party_type='CUSTOMER'`)).toBe(4)
    expect(await num(`select count(*) n from party where party_type='SUPPLIER'`)).toBe(4)
  })

  it('pohon penempatan, kepala, dan deputi terpasang', async () => {
    expect(await num(`select count(*) n from location where parent_id is not null`)).toBe(LOCATIONS.filter((l) => l.parent).length)
    const heads = (await db.query<{ code: string; head: string; deputy: string | null }>(
      `select w.code, h.username head, d.username deputy from warehouse w
         left join app_user h on h.id=w.head_user_id left join app_user d on d.id=w.deputy_user_id order by w.code`)).rows
    expect(heads).toEqual([
      { code: 'WH-F', head: 'kagud_bj', deputy: null },
      { code: 'WH-M', head: 'kagud_material', deputy: 'wakil_kagud_material' },
      { code: 'WH-M2', head: 'kagud_agregat', deputy: null },
    ])
    const dept = (await db.query<{ code: string; head: string | null; deputy: string | null }>(
      `select d.code, h.username head, dp.username deputy from department d
         left join app_user h on h.id=d.head_user_id left join app_user dp on dp.id=d.deputy_user_id order by d.code`)).rows
    expect(dept.find((d) => d.code === 'GDG')).toEqual({ code: 'GDG', head: 'kadep_gudang', deputy: 'wakil_kadep_gudang' })
    expect(dept.find((d) => d.code === 'PROD')?.head).toBe('kadep_prod')
  })
})

describe('seeder: skenario transaksi demo', () => {
  it('menghasilkan 32 dokumen dengan sebaran status yang dirancang', async () => {
    expect(summary.demo?.skipped).toBe(false)
    expect(summary.demo?.documents).toBe(32)
    const by = Object.fromEntries((await db.query<{ status: string; n: string }>(
      `select status, count(*) n from document group by status`)).rows.map((r) => [r.status, Number(r.n)]))
    expect(by).toEqual({
      TERVALIDASI: 17, MENUNGGU_VALIDASI: 4, MENUNGGU_APPROVAL: 4, DIKEMBALIKAN: 2, DITOLAK: 2, DRAFT: 3,
    })
  })

  it('semua jenis dokumen terwakili, termasuk pembalik dan opname', async () => {
    const t = Object.fromEntries((await db.query<{ doc_type: string; n: string }>(
      `select doc_type, count(*) n from document group by doc_type`)).rows.map((r) => [r.doc_type, Number(r.n)]))
    expect(Object.keys(t).sort()).toEqual(['DELIVERY_NOTE', 'FG_RECEIPT', 'MATERIAL_RECEIPT', 'MATERIAL_REQUEST', 'STOCK_OPNAME', 'STOCK_TRANSFER'])
    expect(await num(`select count(*) n from document where reverses_document_id is not null and status='TERVALIDASI'`)).toBe(1)
  })

  it('stok per penempatan sesuai perhitungan skenario dan ledger = saldo', async () => {
    expect(await qty('SEMEN-PC', 'M-A1')).toBe(130)   // 400 -80 -90 -100 (pindah)
    expect(await qty('SEMEN-PC', 'M-A2')).toBe(260)   // 200 -40 +100
    expect(await qty('BESI-8', 'M-B1')).toBe(2400)
    expect(await qty('BESI-D13', 'M-B2')).toBe(3800)
    expect(await qty('PASIR', 'AG-P1')).toBe(60)      // 80 -18, opname -2
    expect(await qty('PASIR', 'AG-P2')).toBe(40)
    expect(await qty('BATU-12', 'AG-B1')).toBe(125)
    expect(await qty('UDITCH-60', 'F-1A')).toBe(20)   // 80 -60
    expect(await qty('UDITCH-60', 'F-1B')).toBe(70)
    expect(await qty('BUIS-80', 'F-1C')).toBe(50)     // 150 -100 -10 +10 (pembalik)
    expect(await qty('ADT-RT', 'M-C1')).toBe(0)       // masih menunggu validasi: stok belum bertambah
    expect(await num(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('opname selesai memposting selisih ke ledger; opname berjalan mengunci Blok 1C', async () => {
    const adj = (await db.query<{ qty_out: string; location: string }>(
      `select m.qty_out, l.code as location from stock_movement m join location l on l.id=m.location_id
        where m.doc_type='STOCK_OPNAME'`)).rows
    expect(adj).toEqual([{ qty_out: '2.0000', location: 'AG-P1' }])
    const locks = (await db.query<{ code: string }>(
      `select l.code from opname_lock k join location l on l.id=k.location_id`)).rows
    expect(locks).toEqual([{ code: 'F-1C' }])
  })

  it('surat jalan keluar bernomor berurutan; pengiriman yang dibalik tetap menyimpan nomornya', async () => {
    const nums = (await db.query<{ sj_number: string }>(
      `select sj_number from delivery_note where sj_number is not null order by sj_number`)).rows.map((r) => r.sj_number)
    expect(nums).toHaveLength(3)
    expect(nums.map((n) => n.slice(-4))).toEqual(['0001', '0002', '0003'])
    expect(nums.every((n) => /^SJK\/\d{4}\/\d{2}\/\d{4}$/.test(n))).toBe(true)
  })

  it('PO produksi: reuse nomor, penerimaan bertahap, target tercapai', async () => {
    expect(await num(`select count(*) n from production_po`)).toBe(7)
    const p = await rows<{ po_number: string; received_qty: string; remaining_qty: string; status: string }>(
      db, await uid('staff_prod'), `select po_number, received_qty, remaining_qty, status from v_production_po_progress order by po_number`)
    const get = (n: string) => p.find((x) => x.po_number === n)!
    expect([Number(get('PO-PRD-2611-001').received_qty), Number(get('PO-PRD-2611-001').remaining_qty)]).toEqual([150, 50])
    expect([Number(get('PO-PRD-2611-002').received_qty), Number(get('PO-PRD-2611-002').remaining_qty)]).toEqual([150, 0])
    expect(get('PO-PRD-2611-001').status).toBe('ACTIVE')
    expect(get('PO-PRD-2611-003').status).toBe('PENDING')       // permintaannya belum divalidasi
    // PO-001 memiliki 2 permintaan material dari 2 gudang
    expect(await num(`select count(*) n from material_request r join production_po p on p.id=r.production_po_id where p.po_number='PO-PRD-2611-001'`)).toBe(2)
    const taken = await rows<{ item_code: string; qty: string }>(db, await uid('staff_prod'),
      `select t.item_code, t.qty from v_po_material_taken t join production_po p on p.id=t.po_id where p.po_number='PO-PRD-2611-001' order by 1`)
    expect(taken.map((t) => t.item_code)).toEqual(['ADT-SP', 'BATU-12', 'BESI-8', 'KAWAT-BDR', 'PASIR', 'SEMEN-PC'])
  })

  it('peringatan yang disengaja muncul saat submit (stok kurang dan melebihi target PO)', async () => {
    const w = summary.demo!.warnings
    expect(w).toContainEqual({ doc: 'Q8', code: 'STOCK_LOW' })
    expect(w).toContainEqual({ doc: 'F5', code: 'OVER_TARGET' })
  })

  it('inbox approval/validasi per pengguna berisi dokumen yang tepat (termasuk deputi)', async () => {
    expect(await inbox('kagud_material')).toBe(2)          // R4, Q4
    expect(await inbox('wakil_kagud_material')).toBe(2)    // deputi melihat inbox yang sama
    expect(await inbox('kadep_prod')).toBe(2)              // Q5, Q8
    expect(await inbox('kagud_bj')).toBe(2)                // D4, T2
    expect(await inbox('kadep_gudang')).toBe(2)            // F3, F5
    expect(await inbox('wakil_kadep_gudang')).toBe(2)
    expect(await inbox('kagud_agregat')).toBe(0)
    expect(await inbox('staff_prod')).toBe(0)              // pembuat tidak melihat dokumennya di inbox
  })

  it('penugasan deputi benar-benar dipakai pada riwayat approval', async () => {
    const r = (await db.query<{ approver: string; role: string }>(
      `select a.username approver, s.step_role role from approval_step s
         join document d on d.id=s.document_id join material_receipt m on m.document_id=d.id
         join app_user a on a.id=s.approver_id
        where m.sj_number='SJ-SMN-2611-002' order by s.step_order`)).rows
    expect(r).toEqual([
      { approver: 'wakil_kadep_gudang', role: 'KEPALA_DEPT' },
      { approver: 'wakil_kagud_material', role: 'KEPALA_GUDANG' },
    ])
  })

  it('dikembalikan/ditolak membawa alasan; lampiran terpasang pada dokumen yang bisa diedit', async () => {
    const reasons = (await db.query<{ decision: string; reason: string }>(
      `select decision, reason from approval_step where decision in ('RETURNED','REJECTED') order by decided_at`)).rows
    expect(reasons).toHaveLength(4)
    expect(reasons.every((r) => r.reason && r.reason.length > 10)).toBe(true)
    const att = (await db.query<{ sj: string; status: string }>(
      `select m.sj_number sj, d.status from document_attachment a join document d on d.id=a.document_id
         join material_receipt m on m.document_id=d.id order by 1`)).rows
    expect(att).toEqual([{ sj: 'SJ-SMN-2611-003', status: 'DIKEMBALIKAN' }, { sj: 'SJ-SMN-2611-004', status: 'DRAFT' }])
  })

  it('pembatasan data per peran (RLS) pada data demo', async () => {
    const docsOf = async (u: string) => (await rows(db, await uid(u), `select id from document`)).length
    expect(await docsOf('manajemen')).toBe(32)
    expect(await docsOf('admin')).toBe(32)
    const ownedBy = (u: string) => num(`select count(*) n from document d join app_user u on u.id=d.created_by where u.username=$1`, [u])
    expect(await docsOf('staff_prod')).toBe(await ownedBy('staff_prod'))   // hanya dokumen buatannya sendiri
    expect(await docsOf('staff_prod2')).toBe(await ownedBy('staff_prod2'))
    expect(await docsOf('staff_prod')).toBeLessThan(32)
    expect(await docsOf('staff_bj')).toBe(await num(`select count(*) n from document d join app_user u on u.id=d.created_by where u.username='staff_bj'`))
    const stockWh = async (u: string) => [...new Set((await rows<{ warehouse_code: string }>(db, await uid(u), `select warehouse_code from v_stock`)).map((r) => r.warehouse_code))].sort()
    expect(await stockWh('staff_material')).toEqual(['WH-M'])
    expect(await stockWh('staff_agregat')).toEqual(['WH-M2'])
    expect(await stockWh('kagud_bj')).toEqual(['WH-F'])
    expect(await stockWh('staff_prod')).toEqual([])
    expect(await stockWh('kadep_prod')).toEqual(['WH-F', 'WH-M', 'WH-M2'])
  })

  it('ada item di bawah stok minimum untuk menguji widget peringatan stok', async () => {
    const low = (await db.query<{ code: string }>(
      `select item_code code from v_stock where min_stock is not null group by item_code
        having sum(qty) < max(min_stock) order by 1`)).rows.map((r) => r.code)
    expect(low).toEqual(['ADT-SP', 'PASIR', 'SEMEN-PC'])   // 240<300, 100<120, 390<500
  })

  it('konfigurasi dashboard contoh tersimpan', async () => {
    const r = (await db.query<{ widgets: { keys: string[]; warehouse_id: string } }>(
      `select widgets from dashboard_config c join app_user u on u.id=c.user_id where u.username='kagud_agregat'`)).rows[0]
    expect(r.widgets.keys).toContain('low_stock')
    expect(r.widgets.warehouse_id).toBeTruthy()
  })

  it('idempoten: menjalankan ulang tidak menggandakan master maupun transaksi', async () => {
    const again = await runSeed(api, { demo: true })
    expect(again.demo?.skipped).toBe(true)
    expect(again.master).toEqual(summary.master)
    expect(await num(`select count(*) n from document`)).toBe(32)
    expect(await num(`select count(*) n from item`)).toBe(ITEMS.length)
    expect(await num(`select count(*) n from app_user`)).toBe(USERS.length)
    expect(await num(`select count(*) n from location`)).toBe(LOCATIONS.length)
    expect(await num(`select count(*) n from user_warehouse`)).toBe(USERS.reduce((n, u) => n + (u.wh?.length ?? 0), 0))
    expect(await num(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('kunci opname pada data demo: pengiriman yang tertahan tidak bisa divalidasi sampai opname selesai', async () => {
    // F5 (10 buis ke Blok 1C) menunggu approval; Blok 1C sedang dihitung (O2)
    const f5 = (await db.query<{ id: string }>(
      `select d.id from document d join document_line l on l.document_id=d.id join location x on x.id=l.location_id
        where d.doc_type='FG_RECEIPT' and d.status='MENUNGGU_APPROVAL' and x.code='F-1C'`)).rows[0].id
    await api.rpc('kadep_gudang', 'decide_document', { p_doc_id: f5, p_decision: 'APPROVE', p_reason: null, p_allocations: null })
    expect(await errOf(api.rpc('kagud_bj', 'decide_document', { p_doc_id: f5, p_decision: 'APPROVE', p_reason: null, p_allocations: null })))
      .toContain('LOCATION_UNDER_COUNT')
  })
})
