import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Row, SeedApi } from "./types";

export interface SupabaseApiOptions {
  url: string;
  /** publishable / anon key: dipakai untuk login sebagai tiap user demo */
  publishableKey: string;
  /** service_role key: hanya untuk membuat akun dan upsert master. Jangan pernah dikirim ke browser. */
  serviceKey: string;
  password: string;
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false } } as const;

export function supabaseApi(o: SupabaseApiOptions): SeedApi {
  const service = createClient(o.url, o.serviceKey, noSession);
  const clients = new Map<string, SupabaseClient>();
  let authUsers: Map<string, string> | null = null;

  async function loadAuthUsers() {
    if (authUsers) return authUsers;
    authUsers = new Map();
    for (let page = 1; ; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`listUsers: ${error.message}`);
      for (const u of data.users) if (u.email) authUsers.set(u.email, u.id);
      if (data.users.length < 1000) break;
    }
    return authUsers;
  }

  /** Login sebagai user demo: RPC berjalan dengan JWT-nya, jadi RLS dan aturan pemisahan tugas berlaku. */
  async function asUser(username: string): Promise<SupabaseClient> {
    const cached = clients.get(username);
    if (cached) return cached;
    const c = createClient(o.url, o.publishableKey, noSession);
    const { error } = await c.auth.signInWithPassword({ email: `${username}@wms.local`, password: o.password });
    if (error) throw new Error(`login ${username}: ${error.message}`);
    clients.set(username, c);
    return c;
  }

  return {
    async ensureAuthUser(username) {
      const email = `${username}@wms.local`;
      const users = await loadAuthUsers();
      const existing = users.get(email);
      if (existing) return existing;
      const { data, error } = await service.auth.admin.createUser({ email, password: o.password, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${username}: ${error?.message}`);
      users.set(email, data.user.id);
      return data.user.id;
    },

    async upsert(table, rows, onConflict) {
      const { data, error } = await service.from(table).upsert(rows, { onConflict: onConflict.join(",") }).select();
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
      return (data ?? []) as Row[];
    },

    async update(table, patch, match) {
      const { error } = await service.from(table).update(patch).match(match);
      if (error) throw new Error(`update ${table}: ${error.message}`);
    },

    async select(as, table, match = {}) {
      const client = as ? await asUser(as) : service;
      const { data, error } = await client.from(table).select("*").match(match);
      if (error) throw new Error(`select ${table}: ${error.message}`);
      return (data ?? []) as Row[];
    },

    async rpc(as, fn, args) {
      const { data, error } = await (await asUser(as)).rpc(fn, args);
      // pesan = kode domain (mis. INSUFFICIENT_STOCK), dipertahankan agar mudah dibaca
      if (error) throw new Error(`${fn} sebagai ${as}: ${error.message}${error.details ? ` ${error.details}` : ""}`);
      return data;
    },

    async uploadAttachment(as, docId, fileName, bytes, contentType) {
      const path = `${docId}/${crypto.randomUUID()}.${contentType === "application/pdf" ? "pdf" : contentType.split("/")[1]}`;
      const up = await service.storage.from("attachments").upload(path, bytes, { contentType, upsert: false });
      if (up.error) throw new Error(`upload lampiran: ${up.error.message}`);
      const { error } = await (await asUser(as)).rpc("add_attachment", {
        p_doc_id: docId,
        p_path: path,
        p_file_name: fileName,
        p_content_type: contentType,
        p_size: bytes.length,
      });
      if (error) {
        await service.storage.from("attachments").remove([path]);
        throw new Error(`add_attachment: ${error.message}`);
      }
    },
  };
}
