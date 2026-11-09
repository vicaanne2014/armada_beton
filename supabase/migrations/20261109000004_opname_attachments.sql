-- =====================================================================
-- 0004 STOCK OPNAME + LAMPIRAN SURAT JALAN MASUK
-- Fungsi inti dari 0002 TIDAK ditulis ulang; yang perlu diperluas dibungkus
-- (rename ke *_base lalu fungsi baru mendelegasikan), sisanya lewat trigger.
-- =====================================================================

-- ---------- tipe dokumen baru ----------
alter table public.document drop constraint document_doc_type_check;
alter table public.document add constraint document_doc_type_check check (doc_type in
  ('MATERIAL_RECEIPT','MATERIAL_REQUEST','STOCK_TRANSFER','FG_RECEIPT','DELIVERY_NOTE','STOCK_OPNAME'));

create or replace function private.series_prefix(p_doc_type text, p_is_reversal boolean)
returns text language sql immutable as $$
  select case when p_is_reversal then 'REV' else
    case p_doc_type
      when 'MATERIAL_RECEIPT' then 'RCV'
      when 'MATERIAL_REQUEST' then 'REQ'
      when 'STOCK_TRANSFER'   then 'TRF'
      when 'FG_RECEIPT'       then 'FGR'
      when 'DELIVERY_NOTE'    then 'DLV'
      when 'STOCK_OPNAME'     then 'OPN'
      else 'DOC' end
  end
$$;

-- ---------- permission & alur approval ----------
insert into public.permission(code, description) values
  ('doc.create.stock_opname', 'Buka sesi dan hitung stock opname')
on conflict (code) do nothing;

insert into public.role_permission(role_id, permission_id)
select r.id, p.id
  from (values
    ('STAFF_GUDANG_MATERIAL','doc.create.stock_opname'),
    ('STAFF_GUDANG_BJ','doc.create.stock_opname')
  ) as v(role_code, perm_code)
  join public.app_role r on r.code = v.role_code
  join public.permission p on p.code = v.perm_code
on conflict do nothing;

insert into public.approval_flow_config(doc_type, step_order, step_role, is_active) values
  ('STOCK_OPNAME', 1, 'KEPALA_DEPT',   true),
  ('STOCK_OPNAME', 2, 'KEPALA_GUDANG', true)
on conflict (doc_type, step_order) do nothing;

-- ---------- tabel opname ----------
create table public.opname_line (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document(id) on delete cascade,
  line_no int not null,
  item_id uuid not null references public.item(id),
  location_id uuid not null references public.location(id),
  system_qty numeric(18,4) not null check (system_qty >= 0),   -- snapshot saat sesi dibuka
  counted_qty numeric(18,4) check (counted_qty is null or counted_qty >= 0),
  note text,
  unique (document_id, line_no),
  unique (document_id, item_id, location_id)
);
create index opname_line_doc_idx on public.opname_line (document_id);

-- kunci lunak: penempatan yang sedang dihitung tidak boleh dimutasi dokumen lain
create table public.opname_lock (
  location_id uuid primary key references public.location(id),
  document_id uuid not null references public.document(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index opname_lock_doc_idx on public.opname_lock (document_id);

create trigger opname_line_guard before insert or update or delete on public.opname_line
  for each row execute function private.guard_line();   -- baris hanya boleh berubah saat DRAFT

-- ---------- kunci: blokir mutasi stok pada penempatan yang sedang dihitung ----------
create or replace function private.check_opname_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.opname_lock l
              where l.location_id = new.location_id and l.document_id <> new.document_id) then
    perform private.fail('LOCATION_UNDER_COUNT', jsonb_build_object('location_id', new.location_id));
  end if;
  return new;
end $$;
create trigger movement_opname_lock before insert on public.stock_movement
  for each row execute function private.check_opname_lock();

-- saat submit (DRAFT -> menunggu), dokumen non-opname tidak boleh menyentuh penempatan terkunci
create or replace function private.check_locks_on_submit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.doc_type <> 'STOCK_OPNAME' and exists (
    select 1 from public.document_line l
      join public.opname_lock k on k.location_id = l.location_id or k.location_id = l.to_location_id
     where l.document_id = new.id) then
    perform private.fail('LOCATION_UNDER_COUNT');
  end if;
  return new;
end $$;
create trigger document_lock_on_submit before update of status on public.document
  for each row
  when (old.status = 'DRAFT' and new.status in ('MENUNGGU_APPROVAL','MENUNGGU_VALIDASI'))
  execute function private.check_locks_on_submit();

-- kunci dilepas pada status akhir (tervalidasi / ditolak / dibatalkan)
create or replace function private.release_opname_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.opname_lock where document_id = new.id;
  return new;
end $$;
create trigger document_release_lock after update of status on public.document
  for each row
  when (new.doc_type = 'STOCK_OPNAME' and new.status in ('TERVALIDASI','DITOLAK'))
  execute function private.release_opname_lock();

-- pembalik opname: salin baris hitungan dari dokumen asal
create or replace function private.copy_opname_lines() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.opname_line(document_id, line_no, item_id, location_id, system_qty, counted_qty, note)
  select new.id, line_no, item_id, location_id, system_qty, counted_qty, note
    from public.opname_line where document_id = new.reverses_document_id;
  return new;
end $$;
create trigger document_copy_opname after insert on public.document
  for each row
  when (new.doc_type = 'STOCK_OPNAME' and new.reverses_document_id is not null)
  execute function private.copy_opname_lines();

-- ---------- bungkus validate_for_submit & post_document ----------
alter function private.validate_for_submit(uuid) rename to validate_for_submit_base;
alter function private.post_document(uuid, uuid) rename to post_document_base;

create or replace function private.validate_for_submit(p_doc_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  wh public.warehouse;
begin
  select * into d from public.document where id = p_doc_id;
  if d.doc_type <> 'STOCK_OPNAME' then
    return private.validate_for_submit_base(p_doc_id);
  end if;

  select * into wh from public.warehouse where id = d.warehouse_id;
  if not wh.is_active then perform private.fail('WAREHOUSE_INACTIVE'); end if;
  if not exists (select 1 from public.opname_line where document_id = d.id) then
    perform private.fail('NO_LINES');
  end if;
  if d.reverses_document_id is not null then return '[]'::jsonb; end if;
  if exists (select 1 from public.opname_line where document_id = d.id and counted_qty is null) then
    perform private.fail('OPNAME_UNCOUNTED');
  end if;
  return '[]'::jsonb;
end $$;

create or replace function private.post_document(p_doc_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  v_sign int;
  v_deltas jsonb;
  r record;
  v_bal numeric;
begin
  select * into d from public.document where id = p_doc_id;
  if d.doc_type <> 'STOCK_OPNAME' then
    perform private.post_document_base(p_doc_id, p_actor);
    return;
  end if;

  v_sign := case when d.reverses_document_id is null then 1 else -1 end;

  -- selisih hanya valid bila saldo masih sama dengan snapshot (dijamin kunci lunak)
  if d.reverses_document_id is null then
    for r in select * from public.opname_line where document_id = d.id loop
      select coalesce((select qty from public.stock_balance
                        where item_id = r.item_id and location_id = r.location_id), 0) into v_bal;
      if v_bal <> r.system_qty then
        perform private.fail('OPNAME_STALE', jsonb_build_object(
          'item_id', r.item_id, 'location_id', r.location_id, 'snapshot', r.system_qty, 'current', v_bal));
      end if;
    end loop;
  end if;

  select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', l.location_id,
                                      'delta', (l.counted_qty - l.system_qty) * v_sign, 'line_id', l.id))
    into v_deltas
    from public.opname_line l
   where l.document_id = d.id and l.counted_qty <> l.system_qty;

  if v_deltas is null then return; end if;   -- hitungan fisik sama dengan sistem: tidak ada pergerakan
  perform private.apply_stock_deltas(d.id, d.doc_type, d.doc_no, p_actor, d.warehouse_id, v_deltas);
end $$;

-- ---------- RPC: buka sesi opname ----------
create or replace function public.open_opname(
  p_warehouse_id uuid, p_location_ids uuid[], p_include_children boolean default true, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_user public.app_user;
  v_wh public.warehouse;
  v_id uuid;
  v_scope uuid[];
begin
  select * into v_user from public.app_user where id = v_uid and is_active;
  if not found then perform private.fail('UNAUTHENTICATED'); end if;
  if not private.has_perm('doc.create.stock_opname') then perform private.fail('FORBIDDEN'); end if;
  select * into v_wh from public.warehouse where id = p_warehouse_id and is_active;
  if not found then perform private.fail('WAREHOUSE_NOT_FOUND'); end if;
  if not private.can_access_warehouse(v_wh.id) then perform private.fail('FORBIDDEN'); end if;
  if v_user.department_id is null then perform private.fail('NO_DEPARTMENT'); end if;

  select array_agg(distinct id) into v_scope from (
    with recursive sc(id) as (
      select l.id from public.location l
       where l.id = any(coalesce(p_location_ids, '{}')) and l.warehouse_id = v_wh.id and l.is_active
      union
      select c.id from public.location c join sc on c.parent_id = sc.id
       where p_include_children and c.is_active)
    select id from sc) s;
  if v_scope is null then perform private.fail('OPNAME_SCOPE_EMPTY'); end if;

  insert into public.document(doc_type, warehouse_id, department_id, created_by, note)
  values ('STOCK_OPNAME', v_wh.id, v_user.department_id, v_uid, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;

  begin
    insert into public.opname_lock(location_id, document_id)
    select unnest(v_scope), v_id;
  exception when unique_violation then
    perform private.fail('LOCATION_UNDER_COUNT');   -- sebagian penempatan sudah dihitung sesi lain
  end;

  insert into public.opname_line(document_id, line_no, item_id, location_id, system_qty)
  select v_id, (row_number() over (order by lc.code, i.code))::int, b.item_id, b.location_id, b.qty
    from public.stock_balance b
    join public.location lc on lc.id = b.location_id
    join public.item i on i.id = b.item_id
   where b.location_id = any(v_scope) and b.qty > 0;

  perform private.write_audit('OPNAME_OPEN', 'document', v_id::text, null,
    jsonb_build_object('warehouse_id', v_wh.id, 'locations', cardinality(v_scope)));
  return v_id;
end $$;

-- ---------- RPC: simpan hitungan ----------
create or replace function public.save_opname_count(p_doc_id uuid, p_lines jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  d public.document;
  e jsonb;
  v_line public.opname_line;
  v_item uuid;
  v_loc uuid;
  v_counted numeric;
  v_sys numeric;
  v_n int;
begin
  select * into d from public.document where id = p_doc_id for update;
  if not found or d.doc_type <> 'STOCK_OPNAME' or d.created_by <> v_uid then perform private.fail('FORBIDDEN'); end if;
  if d.reverses_document_id is not null then perform private.fail('INVALID_STATE'); end if;
  if d.status not in ('DRAFT','DIKEMBALIKAN') then perform private.fail('INVALID_STATE'); end if;
  if d.status = 'DIKEMBALIKAN' then update public.document set status = 'DRAFT' where id = d.id; end if;
  if p_note is not null then update public.document set note = nullif(trim(p_note), '') where id = d.id; end if;

  for e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_counted := case when nullif(e->>'counted_qty', '') is null then null else (e->>'counted_qty')::numeric end;

    if nullif(e->>'line_id', '') is not null then
      select * into v_line from public.opname_line
       where id = (e->>'line_id')::uuid and document_id = d.id;
      if not found then perform private.fail('NOT_FOUND'); end if;
      if coalesce((e->>'remove')::boolean, false) then
        if v_line.system_qty <> 0 then perform private.fail('INVALID_INPUT'); end if;   -- hanya baris temuan baru
        delete from public.opname_line where id = v_line.id;
      else
        update public.opname_line set counted_qty = v_counted, note = nullif(trim(coalesce(e->>'note', '')), '')
         where id = v_line.id;
      end if;
    else
      -- item ditemukan fisik di penempatan yang masuk lingkup sesi
      v_item := nullif(e->>'item_id', '')::uuid;
      v_loc := nullif(e->>'location_id', '')::uuid;
      if v_item is null or v_loc is null then perform private.fail('INVALID_INPUT'); end if;
      if not exists (select 1 from public.opname_lock where document_id = d.id and location_id = v_loc) then
        perform private.fail('LOCATION_INVALID');
      end if;
      if not exists (select 1 from public.item i join public.warehouse w on w.id = d.warehouse_id
                      where i.id = v_item and i.is_active and i.item_type = w.category) then
        perform private.fail('ITEM_WAREHOUSE_MISMATCH');
      end if;
      select coalesce((select qty from public.stock_balance where item_id = v_item and location_id = v_loc), 0) into v_sys;
      select coalesce(max(line_no), 0) + 1 into v_n from public.opname_line where document_id = d.id;
      insert into public.opname_line(document_id, line_no, item_id, location_id, system_qty, counted_qty, note)
      values (d.id, v_n, v_item, v_loc, v_sys, v_counted, nullif(trim(coalesce(e->>'note', '')), ''))
      on conflict (document_id, item_id, location_id)
      do update set counted_qty = excluded.counted_qty, note = excluded.note;
    end if;
  end loop;
end $$;

-- ---------- RPC: batalkan sesi (melepas kunci) ----------
create or replace function public.cancel_opname(p_doc_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.document;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then perform private.fail('REASON_REQUIRED'); end if;
  select * into d from public.document where id = p_doc_id for update;
  if not found or d.doc_type <> 'STOCK_OPNAME' then perform private.fail('NOT_FOUND'); end if;
  if d.created_by <> (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if d.status not in ('DRAFT','DIKEMBALIKAN') or d.reverses_document_id is not null then
    perform private.fail('INVALID_STATE');
  end if;
  update public.document set status = 'DITOLAK', note = coalesce(d.note || E'\n', '') || 'Dibatalkan: ' || trim(p_reason)
   where id = d.id;                                      -- trigger melepas kunci
  perform private.write_audit('OPNAME_CANCEL', 'document', d.id::text, null, jsonb_build_object('reason', p_reason));
end $$;

-- ---------- lampiran dokumen (foto surat jalan masuk) ----------
create table public.document_attachment (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_by uuid not null references public.app_user(id),
  uploaded_at timestamptz not null default now()
);
create index document_attachment_doc_idx on public.document_attachment (document_id);

create or replace function public.add_attachment(
  p_doc_id uuid, p_path text, p_file_name text, p_content_type text, p_size int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  v_id uuid;
begin
  select * into d from public.document where id = p_doc_id for update;
  if not found or d.created_by <> (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if d.doc_type <> 'MATERIAL_RECEIPT' or d.reverses_document_id is not null then perform private.fail('ATTACHMENT_INVALID'); end if;
  if d.status not in ('DRAFT','DIKEMBALIKAN') then perform private.fail('INVALID_STATE'); end if;
  if p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size is null or p_size <= 0 or p_size > 5242880
     or p_path is null or left(p_path, length(p_doc_id::text) + 1) <> p_doc_id::text || '/' then
    perform private.fail('ATTACHMENT_INVALID');
  end if;
  if (select count(*) from public.document_attachment where document_id = d.id) >= 5 then
    perform private.fail('ATTACHMENT_LIMIT');
  end if;
  insert into public.document_attachment(document_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
  values (d.id, p_path, left(coalesce(nullif(trim(p_file_name), ''), 'lampiran'), 200), p_content_type, p_size, (select auth.uid()))
  returning id into v_id;
  perform private.write_audit('ATTACHMENT_ADD', 'document', d.id::text, null, jsonb_build_object('file', p_file_name));
  return v_id;
end $$;

-- mengembalikan storage_path agar server bisa menghapus berkasnya
create or replace function public.remove_attachment(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  a public.document_attachment;
  d public.document;
begin
  select * into a from public.document_attachment where id = p_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select * into d from public.document where id = a.document_id for update;
  if d.created_by <> (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if d.status not in ('DRAFT','DIKEMBALIKAN') then perform private.fail('INVALID_STATE'); end if;
  delete from public.document_attachment where id = a.id;
  perform private.write_audit('ATTACHMENT_REMOVE', 'document', d.id::text, null, jsonb_build_object('file', a.file_name));
  return a.storage_path;
end $$;

-- bucket privat. Tidak ada policy storage.objects untuk user login: akses berkas hanya lewat server
-- (service_role) setelah hak akses dokumen diperiksa. Dilewati bila schema storage tidak ada (mis. uji lokal).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 5242880,
            array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ---------- RLS & hak akses ----------
alter table public.opname_line          enable row level security;
alter table public.opname_lock          enable row level security;
alter table public.document_attachment  enable row level security;

create policy opname_line_read on public.opname_line for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy opname_lock_read on public.opname_lock for select to authenticated
  using (private.is_active_user());
create policy document_attachment_read on public.document_attachment for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));

revoke insert, update, delete, truncate on
  public.opname_line, public.opname_lock, public.document_attachment from authenticated;

revoke execute on function public.open_opname(uuid, uuid[], boolean, text)  from public, anon;
revoke execute on function public.save_opname_count(uuid, jsonb, text)       from public, anon;
revoke execute on function public.cancel_opname(uuid, text)                  from public, anon;
revoke execute on function public.add_attachment(uuid, text, text, text, int) from public, anon;
revoke execute on function public.remove_attachment(uuid)                    from public, anon;
grant execute on function public.open_opname(uuid, uuid[], boolean, text)  to authenticated;
grant execute on function public.save_opname_count(uuid, jsonb, text)       to authenticated;
grant execute on function public.cancel_opname(uuid, text)                  to authenticated;
grant execute on function public.add_attachment(uuid, text, text, text, int) to authenticated;
grant execute on function public.remove_attachment(uuid)                    to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_active_user()           to authenticated;
grant execute on function private.has_perm(text)             to authenticated;
grant execute on function private.can_access_warehouse(uuid) to authenticated;

revoke all on all tables in schema public from anon;
