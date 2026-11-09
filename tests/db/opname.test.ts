import { describe, it, expect, beforeEach } from 'vitest'
import {
  makeDb, seedFixture, rpc, rows, one, errOf, balance, statusOf, lineIds, receiveMaterial,
  type Db, type Ids,
} from './harness'

let db: Db
let ids: Ids

beforeEach(async () => {
  db = await makeDb()
  ids = await seedFixture(db)
})

const arr = (xs: string[]) => `{${xs.join(',')}}`
const open = async (uid: string, wh: string, locs: string[], include = true, note: string | null = null) =>
  (await one<{ id: string }>(db, uid, `select public.open_opname($1,$2::uuid[],$3,$4) as id`, [wh, arr(locs), include, note])).id
const countLines = (uid: string, doc: string, lines: object[]) =>
  one(db, uid, `select public.save_opname_count($1,$2::jsonb,null)`, [doc, JSON.stringify(lines)])
const olines = async (doc: string) =>
  (await db.query<{ id: string; item_id: string; location_id: string; system_qty: string; counted_qty: string | null }>(
    `select id, item_id, location_id, system_qty, counted_qty from opname_line where document_id=$1 order by line_no`, [doc])).rows
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0].n)
const lockCount = (doc?: string) =>
  doc ? count(`select count(*) n from opname_lock where document_id=$1`, [doc]) : count(`select count(*) n from opname_lock`)

async function newMaterialItem(code: string) {
  return (await db.query<{ id: string }>(
    `insert into item(code,name,item_type,uom_id) values ($1,$1,'MATERIAL',$2) returning id`, [code, ids.uomKg])).rows[0].id
}
const submitApprove = async (doc: string) => {
  await rpc.submit(db, ids.sgm, doc)
  await rpc.decide(db, ids.kdg, doc, 'APPROVE')
}

describe('stock opname', () => {
  it('hitung → selisih diposting saat validasi (kurang, lebih, item temuan); ledger tetap sesuai', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000, item: ids.semen })
    await receiveMaterial(db, ids, { sj: 'SJ-2', qty: 500, item: ids.pasir })
    const batu = await newMaterialItem('BATU')

    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const ls = await olines(doc)
    expect(ls).toHaveLength(2)                                   // snapshot hanya item berstok
    expect(ls.map((l) => Number(l.system_qty)).sort((a, b) => a - b)).toEqual([500, 1000])
    expect(await lockCount(doc)).toBe(1)

    const semen = ls.find((l) => l.item_id === ids.semen)!
    const pasir = ls.find((l) => l.item_id === ids.pasir)!
    await countLines(ids.sgm, doc, [
      { line_id: semen.id, counted_qty: '990' },                // kurang 10
      { line_id: pasir.id, counted_qty: '500' },                // sama
      { item_id: batu, location_id: ids.locMA, counted_qty: '30' },   // ditemukan fisik, belum ada di sistem
    ])
    await submitApprove(doc)
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)   // belum berubah sebelum validasi
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')

    expect(await statusOf(db, doc)).toBe('TERVALIDASI')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(990)
    expect(await balance(db, ids.pasir, ids.locMA)).toBe(500)
    expect(await balance(db, batu, ids.locMA)).toBe(30)
    const mov = (await db.query<{ item_id: string; qty_in: string; qty_out: string; doc_type: string }>(
      `select item_id, qty_in, qty_out, doc_type from stock_movement where document_id=$1`, [doc])).rows
    expect(mov).toHaveLength(2)                                  // pasir (selisih 0) tidak menghasilkan baris
    expect(mov.every((m) => m.doc_type === 'STOCK_OPNAME')).toBe(true)
    expect(await lockCount()).toBe(0)                            // kunci dilepas
    expect(await count(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('opname tanpa selisih tetap bisa divalidasi tanpa pergerakan', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '100' }])
    await submitApprove(doc)
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')
    expect(await statusOf(db, doc)).toBe('TERVALIDASI')
    expect(await count(`select count(*) n from stock_movement where document_id=$1`, [doc])).toBe(0)
  })

  it('semua baris wajib sudah dihitung sebelum diajukan', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    expect(await errOf(rpc.submit(db, ids.sgm, doc))).toBe('OPNAME_UNCOUNTED')
    const empty = await open(ids.sgm, ids.whM, [ids.locMB])      // tanpa stok sama sekali
    expect(await errOf(rpc.submit(db, ids.sgm, empty))).toBe('NO_LINES')
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '0' }])   // 0 adalah hitungan yang sah
    expect((await rpc.submit(db, ids.sgm, doc)).status).toBe('MENUNGGU_APPROVAL')
  })

  it('kunci lunak: penempatan yang dihitung menahan dokumen lain sampai sesi selesai', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    // dokumen sudah diajukan SEBELUM opname dibuka
    const inflight = await rpc.draft(db, ids.sgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 100, location_id: ids.locMA, to_location_id: ids.locMB }])
    await rpc.submit(db, ids.sgm, inflight)

    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    // validasi dokumen berjalan ditahan
    expect(await errOf(rpc.decide(db, ids.kgm, inflight, 'APPROVE'))).toBe('LOCATION_UNDER_COUNT')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)
    // dokumen baru pada penempatan terkunci tidak bisa diajukan (draft boleh)
    const blocked = await rpc.draft(db, ids.sgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA, to_location_id: ids.locMB }])
    expect(await errOf(rpc.submit(db, ids.sgm, blocked))).toBe('LOCATION_UNDER_COUNT')
    // sesi lain pada penempatan yang sama ditolak; pada penempatan berbeda (tidak terlibat) boleh
    expect(await errOf(open(ids.sgm, ids.whM, [ids.locMA]))).toBe('LOCATION_UNDER_COUNT')
    const locMC = (await db.query<{ id: string }>(
      `insert into location(warehouse_id,code,name) values ($1,'M-C','C') returning id`, [ids.whM])).rows[0].id
    await open(ids.sgm, ids.whM, [locMC])
    // tujuan pemindahan (MB) tidak terkunci, tetapi asal (MA) terkunci -> tetap tertahan

    // setelah sesi dibatalkan, dokumen yang tertahan bisa divalidasi
    await one(db, ids.sgm, `select public.cancel_opname($1,'dibatalkan')`, [doc])
    await rpc.decide(db, ids.kgm, inflight, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMB)).toBe(100)
  })

  it('kunci dilepas saat ditolak; opname ditolak tidak mengubah stok', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '50' }])
    await submitApprove(doc)
    await rpc.decide(db, ids.kgm, doc, 'REJECT', 'hitung ulang')
    expect(await statusOf(db, doc)).toBe('DITOLAK')
    expect(await lockCount()).toBe(0)
    expect(await balance(db, ids.semen, ids.locMA)).toBe(100)
  })

  it('dikembalikan: kunci tetap, bisa dihitung ulang lalu diajukan lagi', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '50' }])
    await submitApprove(doc)
    await rpc.decide(db, ids.kgm, doc, 'RETURN', 'cek ulang rak A')
    expect(await statusOf(db, doc)).toBe('DIKEMBALIKAN')
    expect(await lockCount(doc)).toBe(1)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '95' }])
    expect(await statusOf(db, doc)).toBe('DRAFT')
    await rpc.submit(db, ids.sgm, doc)
    await rpc.decide(db, ids.kdg, doc, 'APPROVE')
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(95)
  })

  it('saldo yang berubah di luar kunci terdeteksi (OPNAME_STALE) dan tidak diposting', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '80' }])
    await submitApprove(doc)
    await db.query(`update stock_balance set qty = qty + 5`)    // simulasi jalur tulis yang menyalahi aturan
    expect(await errOf(rpc.decide(db, ids.kgm, doc, 'APPROVE'))).toBe('OPNAME_STALE')
    expect(await statusOf(db, doc)).toBe('MENUNGGU_VALIDASI')
  })

  it('pemisahan tugas dan hak akses sesi', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '90' }])
    await rpc.submit(db, ids.sgm, doc)
    expect(await errOf(rpc.decide(db, ids.sgm, doc, 'APPROVE'))).toBe('FORBIDDEN')           // staff tidak punya doc.decide
    expect(await errOf(rpc.decide(db, ids.kgm, doc, 'APPROVE'))).toBe('NOT_AUTHORIZED_FOR_STEP')   // harus lewat Kepala Dept dulu

    expect(await errOf(open(ids.sgb, ids.whM, [ids.locMA]))).toBe('FORBIDDEN')               // bukan anggota gudang
    expect(await errOf(open(ids.sdp, ids.whM, [ids.locMA]))).toBe('FORBIDDEN')               // tanpa permission
    expect(await errOf(open(ids.sgm, ids.whM, [ids.locFA]))).toBe('OPNAME_SCOPE_EMPTY')      // lokasi gudang lain
    expect(await errOf(countLines(ids.sgb, doc, []))).toBe('FORBIDDEN')                        // bukan pembuat
    expect(await errOf(countLines(ids.sgm, doc, [{ line_id: l.id, counted_qty: '1' }]))).toBe('INVALID_STATE')   // sudah diajukan
  })

  it('lingkup: penempatan turunan ikut dihitung hanya bila diminta', async () => {
    const child = (await db.query<{ id: string }>(
      `insert into location(warehouse_id,code,name,parent_id) values ($1,'M-A1','A1',$2) returning id`,
      [ids.whM, ids.locMA])).rows[0].id
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100, loc: ids.locMA })
    await receiveMaterial(db, ids, { sj: 'SJ-2', qty: 40, loc: child, item: ids.pasir })

    const withKids = await open(ids.sgm, ids.whM, [ids.locMA], true)
    expect((await olines(withKids)).map((x) => x.location_id).sort()).toEqual([ids.locMA, child].sort())
    expect(await lockCount(withKids)).toBe(2)
    await one(db, ids.sgm, `select public.cancel_opname($1,'ulang')`, [withKids])

    const only = await open(ids.sgm, ids.whM, [ids.locMA], false)
    expect((await olines(only)).map((x) => x.location_id)).toEqual([ids.locMA])
    expect(await lockCount(only)).toBe(1)
  })

  it('baris temuan hanya pada penempatan lingkup dan item sejenis; boleh dihapus; batalkan wajib alasan', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    expect(await errOf(countLines(ids.sgm, doc, [{ item_id: ids.pasir, location_id: ids.locMB, counted_qty: '5' }]))).toBe('LOCATION_INVALID')
    expect(await errOf(countLines(ids.sgm, doc, [{ item_id: ids.precast, location_id: ids.locMA, counted_qty: '5' }]))).toBe('ITEM_WAREHOUSE_MISMATCH')
    await countLines(ids.sgm, doc, [{ item_id: ids.pasir, location_id: ids.locMA, counted_qty: '5' }])
    const found = (await olines(doc)).find((x) => x.item_id === ids.pasir)!
    expect(Number(found.system_qty)).toBe(0)
    await countLines(ids.sgm, doc, [{ line_id: found.id, remove: true }])
    expect((await olines(doc)).some((x) => x.item_id === ids.pasir)).toBe(false)
    const sys = (await olines(doc)).find((x) => x.item_id === ids.semen)!
    expect(await errOf(countLines(ids.sgm, doc, [{ line_id: sys.id, remove: true }]))).toBe('INVALID_INPUT')   // baris sistem tidak boleh dihapus

    expect(await errOf(one(db, ids.sgm, `select public.cancel_opname($1,' ')`, [doc]))).toBe('REASON_REQUIRED')
    expect(await errOf(one(db, ids.sgb, `select public.cancel_opname($1,'x')`, [doc]))).toBe('FORBIDDEN')
    await one(db, ids.sgm, `select public.cancel_opname($1,'salah gudang')`, [doc])
    expect(await statusOf(db, doc)).toBe('DITOLAK')
    expect(await lockCount()).toBe(0)
  })

  it('draft opname yang dihapus melepas kunci', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    await one(db, ids.sgm, `select public.delete_draft($1)`, [doc])
    expect(await lockCount()).toBe(0)
    expect(await count(`select count(*) n from opname_line`)).toBe(0)
  })

  it('transaksi pembalik membalik penyesuaian opname', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const batu = await newMaterialItem('BATU')
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    const [l] = await olines(doc)
    await countLines(ids.sgm, doc, [
      { line_id: l.id, counted_qty: '980' },
      { item_id: batu, location_id: ids.locMA, counted_qty: '30' },
    ])
    await submitApprove(doc)
    await rpc.decide(db, ids.kgm, doc, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(980)
    expect(await balance(db, batu, ids.locMA)).toBe(30)

    const rev = await rpc.reversal(db, ids.sgm, doc, 'salah hitung')
    expect(await olines(rev)).toHaveLength(2)                    // baris disalin trigger
    await submitApprove(rev)
    await rpc.decide(db, ids.kgm, rev, 'APPROVE')
    expect(await balance(db, ids.semen, ids.locMA)).toBe(1000)
    expect(await balance(db, batu, ids.locMA)).toBe(0)
    expect(await errOf(rpc.reversal(db, ids.sgm, doc, 'lagi'))).toBe('ALREADY_REVERSED')
    expect(await count(`select count(*) n from v_stock_reconciliation`)).toBe(0)
  })

  it('opname gudang barang jadi oleh staff BJ', async () => {
    // isi stok BJ lewat penerimaan BJ
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 1000 })
    const req = await rpc.draft(db, ids.sdp, 'MATERIAL_REQUEST',
      { warehouse_id: ids.whM, po_number: 'PO-O', finished_item_id: ids.precast, target_qty: 100 }, [{ item_id: ids.semen, qty: 10 }])
    await rpc.submit(db, ids.sdp, req)
    await rpc.decide(db, ids.kdp, req, 'APPROVE')
    const [rl] = await lineIds(db, req)
    await rpc.decide(db, ids.kgm, req, 'APPROVE', null, [{ line_id: rl, location_id: ids.locMA, qty: 10 }])
    const po = (await db.query<{ id: string }>(`select id from production_po where po_number='PO-O'`)).rows[0].id
    const fg = await rpc.draft(db, ids.sgb, 'FG_RECEIPT', { warehouse_id: ids.whF, production_po_id: po },
      [{ item_id: ids.precast, qty: 50, location_id: ids.locFA }])
    await rpc.submit(db, ids.sgb, fg)
    await rpc.decide(db, ids.kdg, fg, 'APPROVE')
    await rpc.decide(db, ids.kgb, fg, 'APPROVE')

    const doc = await open(ids.sgb, ids.whF, [ids.locFA])
    const [l] = await olines(doc)
    await countLines(ids.sgb, doc, [{ line_id: l.id, counted_qty: '48' }])
    await rpc.submit(db, ids.sgb, doc)
    await rpc.decide(db, ids.kdg, doc, 'APPROVE')
    expect(await errOf(rpc.decide(db, ids.kgm, doc, 'APPROVE'))).toBe('NOT_WAREHOUSE_HEAD')   // gudang lain
    await rpc.decide(db, ids.kgb, doc, 'APPROVE')
    expect(await balance(db, ids.precast, ids.locFA)).toBe(48)
  })

  it('data opname hanya terlihat oleh yang berhak (RLS) dan tidak bisa ditulis langsung', async () => {
    await receiveMaterial(db, ids, { sj: 'SJ-1', qty: 100 })
    const doc = await open(ids.sgm, ids.whM, [ids.locMA])
    expect(await rows(db, ids.sgm, `select 1 from opname_line where document_id=$1`, [doc])).toHaveLength(1)
    expect(await rows(db, ids.kgm, `select 1 from opname_line where document_id=$1`, [doc])).toHaveLength(1)
    expect(await rows(db, ids.sdp, `select 1 from opname_line where document_id=$1`, [doc])).toHaveLength(0)
    expect(await errOf(rows(db, ids.sgm, `update opname_line set counted_qty = 0`))).toMatch(/permission denied/i)
    expect(await errOf(rows(db, ids.sgm, `delete from opname_lock`))).toMatch(/permission denied/i)
  })
})

describe('lampiran foto surat jalan masuk', () => {
  const draftReceipt = (sj = 'SJ-L1') =>
    rpc.draft(db, ids.sgm, 'MATERIAL_RECEIPT',
      { warehouse_id: ids.whM, sj_number: sj, receipt_date: '2026-11-09', sender_party_id: ids.sup },
      [{ item_id: ids.semen, qty: 10, location_id: ids.locMA }])
  const add = (uid: string, doc: string, path: string, type = 'image/jpeg', size = 1000, name = 'foto.jpg') =>
    one<{ id: string }>(db, uid, `select public.add_attachment($1,$2,$3,$4,$5) as id`, [doc, path, name, type, size])

  it('pembuat melampirkan pada draft; validasi tipe, ukuran, path, dan batas jumlah', async () => {
    const doc = await draftReceipt()
    await add(ids.sgm, doc, `${doc}/a.jpg`)
    expect(await errOf(add(ids.sgm, doc, `${doc}/a.jpg`))).toMatch(/unique|duplicate/i)      // path unik
    expect(await errOf(add(ids.sgm, doc, `lain/a.jpg`))).toBe('ATTACHMENT_INVALID')          // path di luar folder dokumen
    expect(await errOf(add(ids.sgm, doc, `${doc}/b.exe`, 'application/x-msdownload'))).toBe('ATTACHMENT_INVALID')
    expect(await errOf(add(ids.sgm, doc, `${doc}/c.jpg`, 'image/jpeg', 6 * 1024 * 1024))).toBe('ATTACHMENT_INVALID')
    expect(await errOf(add(ids.sgm, doc, `${doc}/d.jpg`, 'image/jpeg', 0))).toBe('ATTACHMENT_INVALID')
    for (const n of [2, 3, 4, 5]) await add(ids.sgm, doc, `${doc}/f${n}.png`, 'image/png')
    expect(await errOf(add(ids.sgm, doc, `${doc}/f6.png`, 'image/png'))).toBe('ATTACHMENT_LIMIT')
  })

  it('hanya pembuat dan hanya selama draft/dikembalikan; terkunci setelah diajukan', async () => {
    const doc = await draftReceipt()
    const a = await add(ids.sgm, doc, `${doc}/a.jpg`)
    expect(await errOf(add(ids.sgb, doc, `${doc}/x.jpg`))).toBe('FORBIDDEN')
    expect(await errOf(one(db, ids.sgb, `select public.remove_attachment($1)`, [a.id]))).toBe('FORBIDDEN')

    await rpc.submit(db, ids.sgm, doc)
    expect(await errOf(add(ids.sgm, doc, `${doc}/b.jpg`))).toBe('INVALID_STATE')
    expect(await errOf(one(db, ids.sgm, `select public.remove_attachment($1)`, [a.id]))).toBe('INVALID_STATE')

    // dikembalikan -> boleh dilengkapi lagi
    await rpc.decide(db, ids.kdg, doc, 'RETURN', 'foto kurang jelas')
    const b = await add(ids.sgm, doc, `${doc}/b.jpg`)
    const path = (await one<{ p: string }>(db, ids.sgm, `select public.remove_attachment($1) as p`, [b.id])).p
    expect(path).toBe(`${doc}/b.jpg`)                                                         // dikembalikan agar server menghapus berkasnya
  })

  it('hanya untuk surat jalan masuk, dan terlihat hanya oleh yang berhak', async () => {
    const doc = await draftReceipt()
    await add(ids.sgm, doc, `${doc}/a.jpg`)
    await rpc.submit(db, ids.sgm, doc)
    expect(await rows(db, ids.kgm, `select 1 from document_attachment`)).toHaveLength(1)      // Kepala Gudang gudang itu
    expect(await rows(db, ids.sgm, `select 1 from document_attachment`)).toHaveLength(1)
    expect(await rows(db, ids.sdp, `select 1 from document_attachment`)).toHaveLength(0)
    expect(await rows(db, ids.sgb, `select 1 from document_attachment`)).toHaveLength(0)
    expect(await errOf(rows(db, ids.sgm, `insert into document_attachment(document_id,storage_path,file_name,content_type,size_bytes,uploaded_by) values ($1,'x','x','image/png',1,$2)`, [doc, ids.sgm])))
      .toMatch(/permission denied/i)

    const tr = await rpc.draft(db, ids.sgm, 'STOCK_TRANSFER', { warehouse_id: ids.whM },
      [{ item_id: ids.semen, qty: 1, location_id: ids.locMA, to_location_id: ids.locMB }])
    expect(await errOf(add(ids.sgm, tr, `${tr}/a.jpg`))).toBe('ATTACHMENT_INVALID')
  })

  it('lampiran ikut terhapus bersama draft (baris); audit mencatat tambah/hapus', async () => {
    const doc = await draftReceipt()
    const a = await add(ids.sgm, doc, `${doc}/a.jpg`)
    await one(db, ids.sgm, `select public.remove_attachment($1)`, [a.id])
    await add(ids.sgm, doc, `${doc}/b.jpg`)
    await one(db, ids.sgm, `select public.delete_draft($1)`, [doc])
    expect(Number((await db.query<{ n: string }>(`select count(*) n from document_attachment`)).rows[0].n)).toBe(0)
    const acts = (await db.query<{ action: string }>(`select action from audit_log where action like 'ATTACHMENT_%' order by id`)).rows.map((r) => r.action)
    expect(acts).toEqual(['ATTACHMENT_ADD', 'ATTACHMENT_REMOVE', 'ATTACHMENT_ADD'])
  })
})
