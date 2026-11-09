import { withUser, type Db } from './harness'
import type { Row, SeedApi } from '../../scripts/seed/types'

const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"'
const param = (v: unknown) => (v === undefined ? null : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

/** Implementasi SeedApi di atas PGlite: sama dengan Supabase (RLS, grant, RPC), tanpa jaringan. */
export function pgliteSeedApi(db: Db): SeedApi {
  const uidCache = new Map<string, string>()
  const uidOf = async (username: string) => {
    const hit = uidCache.get(username)
    if (hit) return hit
    const r = await db.query<{ id: string }>(`select id from app_user where username = $1`, [username])
    if (!r.rows.length) throw new Error(`user demo tidak ada: ${username}`)
    uidCache.set(username, r.rows[0].id)
    return r.rows[0].id
  }
  const where = (match: Row, start = 1) => {
    const keys = Object.keys(match)
    return {
      sql: keys.length ? ' where ' + keys.map((k, i) => `${ident(k)} = $${start + i}`).join(' and ') : '',
      params: keys.map((k) => param(match[k])),
    }
  }

  const api: SeedApi = {
    async ensureAuthUser(username) {
      const email = `${username}@wms.local`
      const found = await db.query<{ id: string }>(`select id from auth.users where email = $1`, [email])
      if (found.rows.length) return found.rows[0].id
      return (await db.query<{ id: string }>(`insert into auth.users(email) values ($1) returning id`, [email])).rows[0].id
    },

    async upsert(table, rows, onConflict) {
      const out: Row[] = []
      for (const row of rows) {
        const cols = Object.keys(row)
        const updatable = cols.filter((c) => !onConflict.includes(c))
        const set = (updatable.length ? updatable : [onConflict[0]]).map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')
        const sql =
          `insert into ${ident(table)} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ` +
          `on conflict (${onConflict.map(ident).join(', ')}) do update set ${set} returning *`
        out.push((await db.query<Row>(sql, cols.map((c) => param(row[c])))).rows[0])
      }
      return out
    },

    async update(table, patch, match) {
      const keys = Object.keys(patch)
      const w = where(match, keys.length + 1)
      await db.query(
        `update ${ident(table)} set ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')}${w.sql}`,
        [...keys.map((k) => param(patch[k])), ...w.params],
      )
    },

    async select(as, table, match = {}) {
      const w = where(match)
      const run = async () => (await db.query<Row>(`select * from ${ident(table)}${w.sql}`, w.params)).rows
      return as ? withUser(db, await uidOf(as), run) : run()
    },

    async rpc(as, fn, args) {
      const parts: string[] = []
      const params: unknown[] = []
      Object.entries(args).forEach(([name, v], i) => {
        let cast = ''
        let val: unknown = v
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          val = `{${v.join(',')}}`
          cast = '::uuid[]'
        } else if (v !== null && typeof v === 'object') {
          val = JSON.stringify(v)
          cast = '::jsonb'
        }
        params.push(val ?? null)
        parts.push(`${name} => $${i + 1}${cast}`)
      })
      const rows = await withUser(db, await uidOf(as), async () =>
        (await db.query<{ r: unknown }>(`select public.${fn}(${parts.join(', ')}) as r`, params)).rows)
      return rows[0].r
    },

    // tanpa Storage lokal: hanya mencatat baris lampiran lewat RPC yang sama
    async uploadAttachment(as, docId, fileName, bytes, contentType) {
      const ext = contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1]
      await api.rpc(as, 'add_attachment', {
        p_doc_id: docId,
        p_path: `${docId}/${crypto.randomUUID()}.${ext}`,
        p_file_name: fileName,
        p_content_type: contentType,
        p_size: bytes.length,
      })
    },
  }
  return api
}
