-- =====================================================================
-- 0002 DOKUMEN, LEDGER, APPROVAL
-- Seluruh mutasi dokumen/stok lewat fungsi RPC SECURITY DEFINER.
-- Tidak ada policy tulis pada tabel dokumen/stok untuk role authenticated.
-- =====================================================================

-- ---------- penomoran tanpa celah ----------
create table public.doc_counter (
  series text not null,
  period text not null,
  last_value int not null default 0,
  primary key (series, period)
);

create or replace function private.next_number(p_series text, p_period text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.doc_counter(series, period, last_value) values (p_series, p_period, 1)
  on conflict (series, period)
  do update set last_value = public.doc_counter.last_value + 1
  returning last_value into v;
  return v;   -- kunci baris dilepas saat commit; rollback membatalkan kenaikan -> tanpa celah
end $$;

-- periode bulanan zona Asia/Jakarta (UTC+7 tanpa DST)
create or replace function private.period_now() returns text
language sql stable as $$
  select to_char((now() at time zone 'UTC') + interval '7 hours', 'YYYYMM')
$$;

create or replace function private.format_number(p_prefix text, p_period text, p_n int)
returns text language sql immutable as $$
  select p_prefix || '/' || substr(p_period, 1, 4) || '/' || substr(p_period, 5, 2) || '/' || lpad(p_n::text, 4, '0')
$$;

create or replace function private.series_prefix(p_doc_type text, p_is_reversal boolean)
returns text language sql immutable as $$
  select case when p_is_reversal then 'REV' else
    case p_doc_type
      when 'MATERIAL_RECEIPT' then 'RCV'
      when 'MATERIAL_REQUEST' then 'REQ'
      when 'STOCK_TRANSFER'   then 'TRF'
      when 'FG_RECEIPT'       then 'FGR'
      when 'DELIVERY_NOTE'    then 'DLV'
      else 'DOC' end
  end
$$;

-- ---------- PO produksi ----------
create table public.production_po (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  finished_item_id uuid not null references public.item(id),
  target_qty numeric(18,4) not null check (target_qty > 0),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE')),
  created_by uuid references public.app_user(id),
  created_at timestamptz not null default now()
);

-- ---------- dokumen generik ----------
create table public.document (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in
    ('MATERIAL_RECEIPT','MATERIAL_REQUEST','STOCK_TRANSFER','FG_RECEIPT','DELIVERY_NOTE')),
  doc_no text,
  status text not null default 'DRAFT' check (status in
    ('DRAFT','MENUNGGU_APPROVAL','MENUNGGU_VALIDASI','DIKEMBALIKAN','DITOLAK','TERVALIDASI')),
  warehouse_id uuid not null references public.warehouse(id),
  department_id uuid not null references public.department(id),
  created_by uuid not null references public.app_user(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references public.app_user(id),
  cycle int not null default 0,
  reverses_document_id uuid references public.document(id),
  note text,
  unique (doc_type, doc_no)
);
-- satu dokumen hanya boleh punya satu pembalik yang masih hidup
create unique index one_live_reversal on public.document (reverses_document_id)
  where reverses_document_id is not null and status <> 'DITOLAK';
create index document_status_wh_idx on public.document (status, warehouse_id);
create index document_created_by_idx on public.document (created_by);
create index document_type_idx on public.document (doc_type, created_at desc);

create table public.document_line (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document(id) on delete cascade,
  line_no int not null,
  item_id uuid not null references public.item(id),
  qty numeric(18,4) not null check (qty > 0),
  location_id uuid references public.location(id),
  to_location_id uuid references public.location(id),
  unique (document_id, line_no)
);
create index document_line_doc_idx on public.document_line (document_id);

-- alokasi penempatan sumber untuk permintaan material (dipilih saat validasi)
create table public.document_line_alloc (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.document_line(id) on delete cascade,
  location_id uuid not null references public.location(id),
  qty numeric(18,4) not null check (qty > 0)
);
create index document_line_alloc_line_idx on public.document_line_alloc (line_id);

-- ekstensi per tipe (kolom nullable karena draft boleh belum lengkap)
create table public.material_receipt (
  document_id uuid primary key references public.document(id) on delete cascade,
  sj_number text,
  receipt_date date,
  sender_party_id uuid references public.party(id),
  po_reference_id uuid references public.po_reference(id),
  sj_reserved boolean not null default true
);
-- nomor surat jalan masuk unik per pengirim; dibebaskan bila dokumen ditolak (BR-08)
create unique index uq_sj_masuk on public.material_receipt (sender_party_id, lower(sj_number))
  where sj_reserved and sj_number is not null;

create table public.material_request (
  document_id uuid primary key references public.document(id) on delete cascade,
  po_number text,
  finished_item_id uuid references public.item(id),
  target_qty numeric(18,4) check (target_qty is null or target_qty > 0),
  production_po_id uuid references public.production_po(id)
);

create table public.fg_receipt (
  document_id uuid primary key references public.document(id) on delete cascade,
  production_po_id uuid references public.production_po(id)
);

create table public.delivery_note (
  document_id uuid primary key references public.document(id) on delete cascade,
  customer_id uuid references public.party(id),
  delivery_date date,
  customer_po_ref text,
  sj_number text unique
);

-- ---------- ledger & saldo ----------
create table public.stock_balance (
  item_id uuid not null references public.item(id),
  location_id uuid not null references public.location(id),
  warehouse_id uuid not null references public.warehouse(id),
  qty numeric(18,4) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);
create index stock_balance_wh_idx on public.stock_balance (warehouse_id);

create table public.stock_movement (
  id bigint generated always as identity primary key,
  warehouse_id uuid not null references public.warehouse(id),
  item_id uuid not null references public.item(id),
  location_id uuid not null references public.location(id),
  qty_in numeric(18,4) not null default 0 check (qty_in >= 0),
  qty_out numeric(18,4) not null default 0 check (qty_out >= 0),
  check ((qty_in > 0) <> (qty_out > 0)),
  document_id uuid not null references public.document(id),
  doc_type text not null,
  doc_no text not null,
  line_id uuid,
  posted_at timestamptz not null default now(),
  posted_by uuid not null references public.app_user(id)
);
create index stock_movement_card_idx on public.stock_movement (item_id, location_id, id);
create index stock_movement_wh_idx on public.stock_movement (warehouse_id, posted_at);
create index stock_movement_doc_idx on public.stock_movement (document_id);

create trigger movement_no_mutation before update or delete on public.stock_movement
  for each row execute function private.forbid_mutation();
create trigger movement_no_truncate before truncate on public.stock_movement
  for each statement execute function private.forbid_mutation();

-- ---------- approval ----------
create table public.approval_flow_config (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null,
  step_order int not null,
  step_role text not null check (step_role in ('KEPALA_DEPT','KEPALA_GUDANG')),
  is_active boolean not null default true,
  unique (doc_type, step_order),
  -- validasi Kepala Gudang tidak boleh dimatikan (BR-12)
  check (step_role <> 'KEPALA_GUDANG' or is_active)
);

create table public.approval_step (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document(id) on delete cascade,
  cycle int not null,
  step_order int not null,
  step_role text not null,
  decision text not null default 'PENDING'
    check (decision in ('PENDING','APPROVED','RETURNED','REJECTED','SKIPPED')),
  approver_id uuid references public.app_user(id),
  reason text,
  decided_at timestamptz,
  unique (document_id, cycle, step_order)
);
create index approval_step_pending_idx on public.approval_step (document_id) where decision = 'PENDING';

-- ---------- notifikasi & dashboard ----------
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user(id) on delete cascade,
  document_id uuid references public.document(id) on delete cascade,
  kind text not null check (kind in
    ('APPROVAL_NEEDED','VALIDATION_NEEDED','RETURNED','REJECTED','VALIDATED')),
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notification_user_idx on public.notification (user_id, created_at desc);

create table public.dashboard_config (
  user_id uuid primary key references public.app_user(id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger audit_flow_config after insert or update or delete on public.approval_flow_config
  for each row execute function private.audit_row();

-- ---------- guard imutabilitas dokumen (BR-07) ----------
create or replace function private.guard_document() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then perform private.fail('DOCUMENT_LOCKED'); end if;
    return old;
  end if;
  if old.status in ('TERVALIDASI','DITOLAK') then
    perform private.fail('DOCUMENT_LOCKED');
  end if;
  return new;
end $$;
create trigger document_guard before update or delete on public.document
  for each row execute function private.guard_document();

create or replace function private.guard_line() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.document
   where id = coalesce(new.document_id, old.document_id);
  -- v_status null = dokumen sedang dihapus (cascade) -> boleh
  if v_status is not null and v_status <> 'DRAFT' then
    perform private.fail('DOCUMENT_LOCKED');
  end if;
  return coalesce(new, old);
end $$;
create trigger document_line_guard before insert or update or delete on public.document_line
  for each row execute function private.guard_line();

create or replace function private.guard_alloc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select d.status into v_status
    from public.document_line l join public.document d on d.id = l.document_id
   where l.id = coalesce(new.line_id, old.line_id);
  if v_status is not null and v_status not in ('DRAFT','MENUNGGU_VALIDASI') then
    perform private.fail('DOCUMENT_LOCKED');
  end if;
  return coalesce(new, old);
end $$;
create trigger document_alloc_guard before insert or update or delete on public.document_line_alloc
  for each row execute function private.guard_alloc();

-- ---------- notifikasi & eligibility ----------
create or replace function private.eligible_approvers(
  p_department_id uuid, p_warehouse_id uuid, p_created_by uuid, p_role text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id from public.app_user u
  where u.is_active and u.id <> p_created_by and u.id in (
    select x from (
      select d.head_user_id as x from public.department d where p_role = 'KEPALA_DEPT' and d.id = p_department_id
      union
      select d.deputy_user_id from public.department d where p_role = 'KEPALA_DEPT' and d.id = p_department_id
      union
      select w.head_user_id from public.warehouse w where p_role = 'KEPALA_GUDANG' and w.id = p_warehouse_id
      union
      select w.deputy_user_id from public.warehouse w where p_role = 'KEPALA_GUDANG' and w.id = p_warehouse_id
    ) s where x is not null)
$$;

create or replace function private.step_actor_ok(p_doc public.document, p_role text, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and p_uid in (
    select private.eligible_approvers(p_doc.department_id, p_doc.warehouse_id, p_doc.created_by, p_role))
$$;

create or replace function private.notify_users(
  p_users uuid[], p_doc_id uuid, p_kind text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification(user_id, document_id, kind, message)
  select distinct u, p_doc_id, p_kind, p_message from unnest(p_users) u where u is not null;
end $$;

create or replace function private.notify_step(p_doc public.document, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_users(
    array(select private.eligible_approvers(p_doc.department_id, p_doc.warehouse_id, p_doc.created_by, p_role)),
    p_doc.id,
    case when p_role = 'KEPALA_DEPT' then 'APPROVAL_NEEDED' else 'VALIDATION_NEEDED' end,
    case when p_role = 'KEPALA_DEPT'
         then 'Dokumen ' || coalesce(p_doc.doc_no, '') || ' menunggu approval Anda'
         else 'Dokumen ' || coalesce(p_doc.doc_no, '') || ' menunggu validasi Anda' end);
end $$;

-- ---------- layanan stok (satu-satunya jalur tulis ledger & saldo) ----------
create or replace function private.apply_stock_deltas(
  p_document_id uuid, p_doc_type text, p_doc_no text, p_actor uuid,
  p_warehouse_id uuid, p_deltas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_wh uuid;
  v_active boolean;
  v_cat text;
  v_wh_cat text;
  v_cur numeric;
begin
  if p_deltas is null or jsonb_array_length(p_deltas) = 0 then
    perform private.fail('NO_LINES');
  end if;
  select category into v_wh_cat from public.warehouse where id = p_warehouse_id;

  -- agregasi per (item, lokasi) dengan urutan kunci tetap -> tanpa deadlock antar transaksi
  for r in
    select (d->>'item_id')::uuid as item_id,
           (d->>'location_id')::uuid as location_id,
           sum((d->>'delta')::numeric) as delta
    from jsonb_array_elements(p_deltas) d
    group by 1, 2
    order by 1, 2
  loop
    select l.warehouse_id, l.is_active into v_wh, v_active from public.location l where l.id = r.location_id;
    if v_wh is null or v_wh <> p_warehouse_id then
      perform private.fail('LOCATION_INVALID', jsonb_build_object('location_id', r.location_id));
    end if;
    select i.item_type into v_cat from public.item i where i.id = r.item_id;
    if v_cat is distinct from v_wh_cat then
      perform private.fail('ITEM_WAREHOUSE_MISMATCH', jsonb_build_object('item_id', r.item_id));
    end if;
    if r.delta > 0 and not v_active then
      perform private.fail('LOCATION_INVALID', jsonb_build_object('location_id', r.location_id));
    end if;

    insert into public.stock_balance(item_id, location_id, warehouse_id, qty)
    values (r.item_id, r.location_id, v_wh, 0)
    on conflict (item_id, location_id) do nothing;

    select qty into v_cur from public.stock_balance
     where item_id = r.item_id and location_id = r.location_id for update;

    if v_cur + r.delta < 0 then
      perform private.fail('INSUFFICIENT_STOCK', jsonb_build_object(
        'item_id', r.item_id, 'location_id', r.location_id,
        'available', v_cur, 'required', -r.delta));
    end if;

    update public.stock_balance set qty = v_cur + r.delta, updated_at = now()
     where item_id = r.item_id and location_id = r.location_id;
  end loop;

  -- satu baris ledger per baris dokumen (bukan agregat) agar kartu stok bisa ditelusuri
  insert into public.stock_movement
    (warehouse_id, item_id, location_id, qty_in, qty_out,
     document_id, doc_type, doc_no, line_id, posted_by)
  select p_warehouse_id, (d->>'item_id')::uuid, (d->>'location_id')::uuid,
         greatest((d->>'delta')::numeric, 0), greatest(-(d->>'delta')::numeric, 0),
         p_document_id, p_doc_type, p_doc_no, nullif(d->>'line_id','')::uuid, p_actor
  from jsonb_array_elements(p_deltas) d
  where (d->>'delta')::numeric <> 0;
end $$;

create or replace function private.post_document(p_doc_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  v_sign int;
  v_deltas jsonb;
begin
  select * into d from public.document where id = p_doc_id;
  v_sign := case when d.reverses_document_id is null then 1 else -1 end;

  if d.doc_type in ('MATERIAL_RECEIPT','FG_RECEIPT') then
    select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', l.location_id,
                                        'delta', l.qty * v_sign, 'line_id', l.id))
      into v_deltas from public.document_line l where l.document_id = d.id;
  elsif d.doc_type = 'DELIVERY_NOTE' then
    select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', l.location_id,
                                        'delta', -l.qty * v_sign, 'line_id', l.id))
      into v_deltas from public.document_line l where l.document_id = d.id;
  elsif d.doc_type = 'MATERIAL_REQUEST' then
    select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'location_id', a.location_id,
                                        'delta', -a.qty * v_sign, 'line_id', l.id))
      into v_deltas
      from public.document_line l join public.document_line_alloc a on a.line_id = l.id
     where l.document_id = d.id;
  elsif d.doc_type = 'STOCK_TRANSFER' then
    select jsonb_agg(x) into v_deltas from (
      select jsonb_build_object('item_id', l.item_id, 'location_id', l.location_id,
                                'delta', -l.qty * v_sign, 'line_id', l.id) as x
        from public.document_line l where l.document_id = d.id
      union all
      select jsonb_build_object('item_id', l.item_id, 'location_id', l.to_location_id,
                                'delta', l.qty * v_sign, 'line_id', l.id)
        from public.document_line l where l.document_id = d.id) s;
  end if;

  perform private.apply_stock_deltas(d.id, d.doc_type, d.doc_no, p_actor, d.warehouse_id, v_deltas);
end $$;

-- alokasi penempatan sumber untuk permintaan material (dipilih Kepala Gudang saat validasi)
create or replace function private.store_allocations(p_doc_id uuid, p_alloc jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  r record;
begin
  select * into d from public.document where id = p_doc_id;
  if p_alloc is null or jsonb_typeof(p_alloc) <> 'array' or jsonb_array_length(p_alloc) = 0 then
    perform private.fail('ALLOCATION_REQUIRED');
  end if;

  delete from public.document_line_alloc
   where line_id in (select id from public.document_line where document_id = p_doc_id);

  if exists (
    select 1 from jsonb_to_recordset(p_alloc) as a(line_id uuid, location_id uuid, qty numeric)
     where a.line_id not in (select id from public.document_line where document_id = p_doc_id)
        or a.qty is null or a.qty <= 0) then
    perform private.fail('ALLOCATION_INVALID');
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_alloc) as a(line_id uuid, location_id uuid, qty numeric)
    left join public.location x on x.id = a.location_id
     where x.id is null or x.warehouse_id <> d.warehouse_id or not x.is_active) then
    perform private.fail('LOCATION_INVALID');
  end if;

  insert into public.document_line_alloc(line_id, location_id, qty)
  select a.line_id, a.location_id, a.qty
    from jsonb_to_recordset(p_alloc) as a(line_id uuid, location_id uuid, qty numeric);

  -- total alokasi per baris harus sama dengan qty diminta
  for r in
    select l.id, l.qty, coalesce(sum(a.qty), 0) as allocated
      from public.document_line l
      left join public.document_line_alloc a on a.line_id = l.id
     where l.document_id = p_doc_id
     group by l.id, l.qty
  loop
    if r.allocated <> r.qty then
      perform private.fail('ALLOCATION_MISMATCH', jsonb_build_object(
        'line_id', r.id, 'requested', r.qty, 'allocated', r.allocated));
    end if;
  end loop;
end $$;

-- ---------- RPC: simpan draft ----------
create or replace function public.save_draft(p_doc_type text, p_doc_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_user public.app_user;
  v_doc public.document;
  v_wh public.warehouse;
  v_h jsonb := coalesce(p_payload->'header', '{}'::jsonb);
  v_id uuid;
  v_line jsonb;
  v_n int := 0;
  v_cat text;
  v_po uuid;
begin
  select * into v_user from public.app_user where id = v_uid and is_active;
  if not found then perform private.fail('UNAUTHENTICATED'); end if;
  if p_doc_type not in ('MATERIAL_RECEIPT','MATERIAL_REQUEST','STOCK_TRANSFER','FG_RECEIPT','DELIVERY_NOTE') then
    perform private.fail('INVALID_DOC_TYPE');
  end if;
  if not private.has_perm('doc.create.' || lower(p_doc_type)) then
    perform private.fail('FORBIDDEN');
  end if;

  if p_doc_id is null then
    select * into v_wh from public.warehouse
     where id = nullif(v_h->>'warehouse_id','')::uuid and is_active;
    if not found then perform private.fail('WAREHOUSE_NOT_FOUND'); end if;
    -- Staff Departemen mengajukan permintaan ke gudang material tanpa menjadi anggota gudang itu
    if p_doc_type <> 'MATERIAL_REQUEST' and not private.can_access_warehouse(v_wh.id) then
      perform private.fail('FORBIDDEN');
    end if;
    v_cat := case p_doc_type
      when 'MATERIAL_RECEIPT' then 'MATERIAL' when 'MATERIAL_REQUEST' then 'MATERIAL'
      when 'FG_RECEIPT' then 'FINISHED_GOOD' when 'DELIVERY_NOTE' then 'FINISHED_GOOD'
      else v_wh.category end;
    if v_wh.category <> v_cat then perform private.fail('WAREHOUSE_CATEGORY_MISMATCH'); end if;
    if v_user.department_id is null then perform private.fail('NO_DEPARTMENT'); end if;

    insert into public.document(doc_type, warehouse_id, department_id, created_by, note)
    values (p_doc_type, v_wh.id, v_user.department_id, v_uid, nullif(v_h->>'note',''))
    returning id into v_id;
  else
    select * into v_doc from public.document where id = p_doc_id for update;
    if not found or v_doc.created_by <> v_uid then perform private.fail('FORBIDDEN'); end if;
    if v_doc.doc_type <> p_doc_type then perform private.fail('INVALID_DOC_TYPE'); end if;
    if v_doc.status not in ('DRAFT','DIKEMBALIKAN') then perform private.fail('INVALID_STATE'); end if;
    if v_doc.reverses_document_id is not null then
      -- dokumen pembalik: hanya catatan yang boleh berubah
      update public.document set note = coalesce(nullif(v_h->>'note',''), note), status = 'DRAFT'
       where id = v_doc.id;
      return v_doc.id;
    end if;
    v_id := v_doc.id;
    update public.document set note = nullif(v_h->>'note',''), status = 'DRAFT' where id = v_id;
    delete from public.document_line where document_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.document_line(document_id, line_no, item_id, qty, location_id, to_location_id)
    values (v_id, v_n,
            nullif(v_line->>'item_id','')::uuid,
            (v_line->>'qty')::numeric,
            nullif(v_line->>'location_id','')::uuid,
            nullif(v_line->>'to_location_id','')::uuid);
  end loop;

  if p_doc_type = 'MATERIAL_RECEIPT' then
    if nullif(trim(coalesce(v_h->>'po_number','')), '') is not null
       and nullif(v_h->>'sender_party_id','') is not null then
      insert into public.po_reference(po_number, party_id, po_date)
      values (trim(v_h->>'po_number'), (v_h->>'sender_party_id')::uuid, nullif(v_h->>'po_date','')::date)
      on conflict (po_number, party_id)
      do update set po_date = coalesce(excluded.po_date, public.po_reference.po_date)
      returning id into v_po;
    end if;
    begin
      insert into public.material_receipt(document_id, sj_number, receipt_date, sender_party_id, po_reference_id)
      values (v_id, nullif(trim(coalesce(v_h->>'sj_number','')), ''), nullif(v_h->>'receipt_date','')::date,
              nullif(v_h->>'sender_party_id','')::uuid, v_po)
      on conflict (document_id) do update
        set sj_number = excluded.sj_number, receipt_date = excluded.receipt_date,
            sender_party_id = excluded.sender_party_id, po_reference_id = excluded.po_reference_id;
    exception when unique_violation then
      perform private.fail('DUPLICATE_SJ');
    end;
  elsif p_doc_type = 'MATERIAL_REQUEST' then
    insert into public.material_request(document_id, po_number, finished_item_id, target_qty)
    values (v_id, nullif(trim(coalesce(v_h->>'po_number','')), ''),
            nullif(v_h->>'finished_item_id','')::uuid, nullif(v_h->>'target_qty','')::numeric)
    on conflict (document_id) do update
      set po_number = excluded.po_number, finished_item_id = excluded.finished_item_id,
          target_qty = excluded.target_qty;
  elsif p_doc_type = 'FG_RECEIPT' then
    insert into public.fg_receipt(document_id, production_po_id)
    values (v_id, nullif(v_h->>'production_po_id','')::uuid)
    on conflict (document_id) do update set production_po_id = excluded.production_po_id;
  elsif p_doc_type = 'DELIVERY_NOTE' then
    insert into public.delivery_note(document_id, customer_id, delivery_date, customer_po_ref)
    values (v_id, nullif(v_h->>'customer_id','')::uuid, nullif(v_h->>'delivery_date','')::date,
            nullif(v_h->>'customer_po_ref',''))
    on conflict (document_id) do update
      set customer_id = excluded.customer_id, delivery_date = excluded.delivery_date,
          customer_po_ref = excluded.customer_po_ref;
  end if;

  return v_id;
end $$;

create or replace function public.delete_draft(p_doc_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.document;
begin
  select * into d from public.document where id = p_doc_id for update;
  if not found or d.created_by <> (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if d.status <> 'DRAFT' or d.cycle <> 0 then perform private.fail('INVALID_STATE'); end if;
  delete from public.document where id = d.id;
end $$;

-- ---------- validasi sebelum submit ----------
create or replace function private.validate_for_submit(p_doc_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  wh public.warehouse;
  mr public.material_receipt;
  rq public.material_request;
  fr public.fg_receipt;
  dn public.delivery_note;
  po public.production_po;
  v_warn jsonb := '[]'::jsonb;
  v_tmp jsonb;
  v_recv numeric;
  v_in numeric;
begin
  select * into d from public.document where id = p_doc_id;
  select * into wh from public.warehouse where id = d.warehouse_id;
  if not wh.is_active then perform private.fail('WAREHOUSE_INACTIVE'); end if;

  if not exists (select 1 from public.document_line where document_id = d.id) then
    perform private.fail('NO_LINES');
  end if;

  -- BR-15: jenis item = kategori gudang; item aktif
  if exists (select 1 from public.document_line l join public.item i on i.id = l.item_id
              where l.document_id = d.id and (i.item_type <> wh.category or not i.is_active)) then
    perform private.fail('ITEM_WAREHOUSE_MISMATCH');
  end if;

  -- penempatan: aktif dan milik gudang dokumen
  if exists (select 1 from public.document_line l join public.location x on x.id = l.location_id
              where l.document_id = d.id and (x.warehouse_id <> d.warehouse_id or not x.is_active))
     or exists (select 1 from public.document_line l join public.location x on x.id = l.to_location_id
              where l.document_id = d.id and (x.warehouse_id <> d.warehouse_id or not x.is_active)) then
    perform private.fail('LOCATION_INVALID');
  end if;

  if d.doc_type in ('MATERIAL_RECEIPT','FG_RECEIPT','DELIVERY_NOTE')
     and exists (select 1 from public.document_line where document_id = d.id and location_id is null) then
    perform private.fail('LOCATION_REQUIRED');
  end if;

  if d.doc_type = 'STOCK_TRANSFER' then
    if exists (select 1 from public.document_line where document_id = d.id
                and (location_id is null or to_location_id is null)) then
      perform private.fail('LOCATION_REQUIRED');
    end if;
    if exists (select 1 from public.document_line where document_id = d.id and location_id = to_location_id) then
      perform private.fail('TRANSFER_SAME_LOCATION');
    end if;
  end if;

  -- pembalik: baris disalin dari dokumen asal, tidak ada pemeriksaan field tipe
  if d.reverses_document_id is not null then
    return v_warn;
  end if;

  if d.doc_type = 'MATERIAL_RECEIPT' then
    select * into mr from public.material_receipt where document_id = d.id;
    if mr.sj_number is null or mr.receipt_date is null or mr.sender_party_id is null then
      perform private.fail('MISSING_FIELD', jsonb_build_object('fields', 'sj_number, receipt_date, sender_party_id'));
    end if;

  elsif d.doc_type = 'MATERIAL_REQUEST' then
    select * into rq from public.material_request where document_id = d.id;
    if rq.po_number is null or rq.finished_item_id is null or rq.target_qty is null then
      perform private.fail('MISSING_FIELD', jsonb_build_object('fields', 'po_number, finished_item_id, target_qty'));
    end if;
    if not exists (select 1 from public.item where id = rq.finished_item_id and item_type = 'FINISHED_GOOD' and is_active) then
      perform private.fail('PO_ITEM_INVALID');
    end if;
    -- peringatan: stok total gudang per item (lokasi belum dipilih)
    select coalesce(jsonb_agg(jsonb_build_object('code','STOCK_LOW','item_id', x.item_id,
             'available', x.available, 'required', x.required)), '[]'::jsonb) into v_tmp
      from (select l.item_id, sum(l.qty) as required,
                   coalesce((select sum(b.qty) from public.stock_balance b
                              where b.item_id = l.item_id and b.warehouse_id = d.warehouse_id), 0) as available
              from public.document_line l where l.document_id = d.id group by l.item_id) x
     where x.required > x.available;
    v_warn := v_warn || v_tmp;

  elsif d.doc_type = 'FG_RECEIPT' then
    select * into fr from public.fg_receipt where document_id = d.id;
    if fr.production_po_id is null then
      perform private.fail('MISSING_FIELD', jsonb_build_object('fields', 'production_po_id'));
    end if;
    select * into po from public.production_po where id = fr.production_po_id;
    if po.status <> 'ACTIVE' then perform private.fail('PO_NOT_ACTIVE'); end if;
    if exists (select 1 from public.document_line where document_id = d.id and item_id <> po.finished_item_id) then
      perform private.fail('PO_ITEM_MISMATCH');
    end if;
    select coalesce(sum(l.qty * case when dd.reverses_document_id is null then 1 else -1 end), 0) into v_recv
      from public.fg_receipt f join public.document dd on dd.id = f.document_id and dd.status = 'TERVALIDASI'
      join public.document_line l on l.document_id = dd.id
     where f.production_po_id = po.id;
    select coalesce(sum(qty), 0) into v_in from public.document_line where document_id = d.id;
    if v_recv + v_in > po.target_qty then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code','OVER_TARGET',
        'received', v_recv, 'incoming', v_in, 'target', po.target_qty));
    end if;

  elsif d.doc_type = 'DELIVERY_NOTE' then
    select * into dn from public.delivery_note where document_id = d.id;
    if dn.customer_id is null or dn.delivery_date is null then
      perform private.fail('MISSING_FIELD', jsonb_build_object('fields', 'customer_id, delivery_date'));
    end if;
    if not exists (select 1 from public.party where id = dn.customer_id and is_active
                    and party_type in ('CUSTOMER','BOTH')) then
      perform private.fail('PARTY_INVALID');
    end if;
  end if;

  -- peringatan stok per penempatan untuk dokumen yang mengurangi stok
  if d.doc_type in ('DELIVERY_NOTE','STOCK_TRANSFER') then
    select coalesce(jsonb_agg(jsonb_build_object('code','STOCK_LOW','item_id', x.item_id,
             'location_id', x.location_id, 'available', x.available, 'required', x.required)), '[]'::jsonb)
      into v_tmp
      from (select l.item_id, l.location_id, sum(l.qty) as required,
                   coalesce((select b.qty from public.stock_balance b
                              where b.item_id = l.item_id and b.location_id = l.location_id), 0) as available
              from public.document_line l where l.document_id = d.id group by l.item_id, l.location_id) x
     where x.required > x.available;
    v_warn := v_warn || v_tmp;
  end if;

  return v_warn;
end $$;

-- ---------- RPC: submit ----------
create or replace function public.submit_document(p_doc_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  v_uid uuid := (select auth.uid());
  v_period text;
  v_n int;
  v_warn jsonb;
  rq public.material_request;
  po public.production_po;
  v_po uuid;
  r record;
  v_first text;
  v_status text;
  v_doc_no text;
begin
  select * into d from public.document where id = p_doc_id for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if d.created_by <> v_uid then perform private.fail('FORBIDDEN'); end if;
  if d.status <> 'DRAFT' then perform private.fail('INVALID_STATE'); end if;
  if not (private.has_perm('doc.create.' || lower(d.doc_type))
          or (d.reverses_document_id is not null and private.has_perm('doc.create.reversal'))) then
    perform private.fail('FORBIDDEN');
  end if;

  v_warn := private.validate_for_submit(d.id);

  v_doc_no := d.doc_no;
  if v_doc_no is null then
    v_period := private.period_now();
    v_n := private.next_number(private.series_prefix(d.doc_type, d.reverses_document_id is not null), v_period);
    v_doc_no := private.format_number(private.series_prefix(d.doc_type, d.reverses_document_id is not null), v_period, v_n);
  end if;

  -- BR-03: PO produksi lahir dari permintaan material
  if d.doc_type = 'MATERIAL_REQUEST' and d.reverses_document_id is null then
    select * into rq from public.material_request where document_id = d.id;
    select * into po from public.production_po where po_number = rq.po_number for update;
    if not found then
      insert into public.production_po(po_number, finished_item_id, target_qty, created_by)
      values (rq.po_number, rq.finished_item_id, rq.target_qty, v_uid) returning id into v_po;
    else
      if po.finished_item_id <> rq.finished_item_id or po.target_qty <> rq.target_qty then
        perform private.fail('PO_MISMATCH', jsonb_build_object('po_number', rq.po_number,
          'finished_item_id', po.finished_item_id, 'target_qty', po.target_qty));
      end if;
      v_po := po.id;
    end if;
    update public.material_request set production_po_id = v_po where document_id = d.id;
  end if;

  -- snapshot langkah dari konfigurasi; validasi Kepala Gudang selalu ada dan terakhir
  insert into public.approval_step(document_id, cycle, step_order, step_role)
  select d.id, d.cycle + 1, (row_number() over (order by case c.step_role when 'KEPALA_GUDANG' then 1 else 0 end, c.step_order))::int, c.step_role
    from public.approval_flow_config c
   where c.doc_type = d.doc_type and c.is_active;
  if not exists (select 1 from public.approval_step
                  where document_id = d.id and cycle = d.cycle + 1 and step_role = 'KEPALA_GUDANG') then
    insert into public.approval_step(document_id, cycle, step_order, step_role)
    select d.id, d.cycle + 1, coalesce(max(step_order), 0) + 1, 'KEPALA_GUDANG'
      from public.approval_step where document_id = d.id and cycle = d.cycle + 1;
  end if;

  for r in select * from public.approval_step where document_id = d.id and cycle = d.cycle + 1 loop
    if not exists (select 1 from private.eligible_approvers(d.department_id, d.warehouse_id, d.created_by, r.step_role)) then
      perform private.fail('NO_APPROVER', jsonb_build_object('role', r.step_role));
    end if;
  end loop;

  select step_role into v_first from public.approval_step
   where document_id = d.id and cycle = d.cycle + 1 order by step_order limit 1;
  v_status := case when v_first = 'KEPALA_DEPT' then 'MENUNGGU_APPROVAL' else 'MENUNGGU_VALIDASI' end;

  update public.document
     set doc_no = v_doc_no, status = v_status, cycle = d.cycle + 1, submitted_at = now()
   where id = d.id;

  select * into d from public.document where id = p_doc_id;
  perform private.notify_step(d, v_first);
  perform private.write_audit('SUBMIT', 'document', d.id::text, null,
    jsonb_build_object('doc_no', d.doc_no, 'status', d.status, 'cycle', d.cycle));

  return jsonb_build_object('status', v_status, 'doc_no', v_doc_no, 'warnings', v_warn);
end $$;

-- ---------- RPC: keputusan approval / validasi ----------
create or replace function public.decide_document(
  p_doc_id uuid, p_decision text, p_reason text default null, p_allocations jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.document;
  s public.approval_step;
  v_uid uuid := (select auth.uid());
  v_new text;
  v_remaining int;
  v_next text;
  v_n int;
  v_period text;
  v_sj text;
begin
  select * into d from public.document where id = p_doc_id for update;   -- serialisasi keputusan ganda
  if not found then perform private.fail('NOT_FOUND'); end if;
  if d.status not in ('MENUNGGU_APPROVAL','MENUNGGU_VALIDASI') then perform private.fail('INVALID_STATE'); end if;
  if p_decision not in ('APPROVE','RETURN','REJECT') then perform private.fail('INVALID_INPUT'); end if;
  if not private.has_perm('doc.decide') then perform private.fail('FORBIDDEN'); end if;

  select * into s from public.approval_step
   where document_id = d.id and cycle = d.cycle and decision = 'PENDING'
   order by step_order limit 1 for update;
  if not found then perform private.fail('INVALID_STATE'); end if;

  if v_uid = d.created_by then perform private.fail('SELF_APPROVAL'); end if;   -- BR-05
  if not private.step_actor_ok(d, s.step_role, v_uid) then
    perform private.fail(case when s.step_role = 'KEPALA_GUDANG' then 'NOT_WAREHOUSE_HEAD' else 'NOT_AUTHORIZED_FOR_STEP' end);
  end if;
  if p_decision in ('RETURN','REJECT') and nullif(trim(coalesce(p_reason, '')), '') is null then
    perform private.fail('REASON_REQUIRED');                                      -- BR-10
  end if;

  if p_decision = 'APPROVE' then
    update public.approval_step set decision = 'APPROVED', approver_id = v_uid, decided_at = now(),
           reason = nullif(trim(coalesce(p_reason, '')), '')
     where id = s.id;
    select count(*) into v_remaining from public.approval_step
     where document_id = d.id and cycle = d.cycle and decision = 'PENDING';

    if v_remaining = 0 then
      -- langkah terakhir = validasi Kepala Gudang -> posting stok (BR-11)
      if d.doc_type = 'MATERIAL_REQUEST' and d.reverses_document_id is null then
        perform private.store_allocations(d.id, p_allocations);
      end if;
      perform private.post_document(d.id, v_uid);   -- bisa melempar INSUFFICIENT_STOCK -> rollback utuh

      if d.doc_type = 'DELIVERY_NOTE' and d.reverses_document_id is null then
        v_period := private.period_now();
        v_n := private.next_number('SJK', v_period);
        v_sj := private.format_number('SJK', v_period, v_n);
        update public.delivery_note set sj_number = v_sj where document_id = d.id;
      end if;
      if d.doc_type = 'MATERIAL_REQUEST' and d.reverses_document_id is null then
        update public.production_po set status = 'ACTIVE'
         where id = (select production_po_id from public.material_request where document_id = d.id)
           and status = 'PENDING';
      end if;
      update public.document set status = 'TERVALIDASI', validated_at = now(), validated_by = v_uid
       where id = d.id;
      v_new := 'TERVALIDASI';
      perform private.notify_users(array[d.created_by], d.id, 'VALIDATED',
        'Dokumen ' || coalesce(d.doc_no, '') || ' telah divalidasi');
    else
      update public.document set status = 'MENUNGGU_VALIDASI' where id = d.id;
      v_new := 'MENUNGGU_VALIDASI';
      select step_role into v_next from public.approval_step
       where document_id = d.id and cycle = d.cycle and decision = 'PENDING' order by step_order limit 1;
      perform private.notify_step(d, v_next);
    end if;
  else
    update public.approval_step
       set decision = case p_decision when 'RETURN' then 'RETURNED' else 'REJECTED' end,
           approver_id = v_uid, decided_at = now(), reason = trim(p_reason)
     where id = s.id;
    update public.approval_step set decision = 'SKIPPED'
     where document_id = d.id and cycle = d.cycle and decision = 'PENDING';
    v_new := case p_decision when 'RETURN' then 'DIKEMBALIKAN' else 'DITOLAK' end;
    update public.document set status = v_new where id = d.id;
    if p_decision = 'REJECT' and d.doc_type = 'MATERIAL_RECEIPT' then
      update public.material_receipt set sj_reserved = false where document_id = d.id;   -- BR-08
    end if;
    perform private.notify_users(array[d.created_by], d.id,
      case p_decision when 'RETURN' then 'RETURNED' else 'REJECTED' end,
      'Dokumen ' || coalesce(d.doc_no, '') || case p_decision when 'RETURN' then ' dikembalikan: ' else ' ditolak: ' end || trim(p_reason));
  end if;

  perform private.write_audit('DECISION_' || p_decision, 'document', d.id::text,
    jsonb_build_object('status', d.status),
    jsonb_build_object('status', v_new, 'step_role', s.step_role, 'reason', p_reason));
  return jsonb_build_object('status', v_new);
end $$;

-- ---------- RPC: transaksi pembalik (BR-07) ----------
create or replace function public.create_reversal(p_doc_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.document;
  v_uid uuid := (select auth.uid());
  v_new uuid;
begin
  if not private.has_perm('doc.create.reversal') then perform private.fail('FORBIDDEN'); end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then perform private.fail('REASON_REQUIRED'); end if;
  select * into o from public.document where id = p_doc_id for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if not private.can_access_warehouse(o.warehouse_id) then perform private.fail('FORBIDDEN'); end if;
  if o.status <> 'TERVALIDASI' or o.reverses_document_id is not null then perform private.fail('INVALID_STATE'); end if;
  if exists (select 1 from public.document where reverses_document_id = o.id and status <> 'DITOLAK') then
    perform private.fail('ALREADY_REVERSED');
  end if;

  insert into public.document(doc_type, warehouse_id, department_id, created_by, reverses_document_id, note)
  values (o.doc_type, o.warehouse_id, o.department_id, v_uid, o.id, trim(p_reason))
  returning id into v_new;

  insert into public.document_line(document_id, line_no, item_id, qty, location_id, to_location_id)
  select v_new, line_no, item_id, qty, location_id, to_location_id
    from public.document_line where document_id = o.id;

  insert into public.document_line_alloc(line_id, location_id, qty)
  select nl.id, a.location_id, a.qty
    from public.document_line_alloc a
    join public.document_line ol on ol.id = a.line_id and ol.document_id = o.id
    join public.document_line nl on nl.document_id = v_new and nl.line_no = ol.line_no;

  if o.doc_type = 'MATERIAL_RECEIPT' then
    insert into public.material_receipt(document_id, sj_number, receipt_date, sender_party_id, po_reference_id, sj_reserved)
    select v_new, sj_number, receipt_date, sender_party_id, po_reference_id, false
      from public.material_receipt where document_id = o.id;
  elsif o.doc_type = 'MATERIAL_REQUEST' then
    insert into public.material_request(document_id, po_number, finished_item_id, target_qty, production_po_id)
    select v_new, po_number, finished_item_id, target_qty, production_po_id
      from public.material_request where document_id = o.id;
  elsif o.doc_type = 'FG_RECEIPT' then
    insert into public.fg_receipt(document_id, production_po_id)
    select v_new, production_po_id from public.fg_receipt where document_id = o.id;
  elsif o.doc_type = 'DELIVERY_NOTE' then
    insert into public.delivery_note(document_id, customer_id, delivery_date, customer_po_ref)
    select v_new, customer_id, delivery_date, customer_po_ref
      from public.delivery_note where document_id = o.id;
  end if;

  perform private.write_audit('CREATE_REVERSAL', 'document', v_new::text, null,
    jsonb_build_object('reverses', o.id, 'reason', p_reason));
  return v_new;
end $$;

-- ---------- RPC: notifikasi & konfigurasi ----------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = '' as $$
  update public.notification set read_at = now()
   where user_id = (select auth.uid()) and read_at is null
     and (p_ids is null or id = any(p_ids))
$$;

create or replace function public.set_flow_step_active(p_doc_type text, p_step_order int, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_perm('approval_config.manage') then perform private.fail('FORBIDDEN'); end if;
  update public.approval_flow_config set is_active = p_active
   where doc_type = p_doc_type and step_order = p_step_order and step_role = 'KEPALA_DEPT';
  if not found then perform private.fail('FLOW_STEP_LOCKED'); end if;   -- BR-12: hanya langkah Kepala Dept
end $$;

-- ---------- view & fungsi baca ----------
create view public.v_stock with (security_invoker = true) as
select b.item_id, i.code as item_code, i.name as item_name, i.item_type, u.code as uom_code,
       i.min_stock, b.location_id, l.code as location_code, l.name as location_name,
       b.warehouse_id, w.code as warehouse_code, w.name as warehouse_name, b.qty
  from public.stock_balance b
  join public.item i on i.id = b.item_id
  join public.uom u on u.id = i.uom_id
  join public.location l on l.id = b.location_id
  join public.warehouse w on w.id = b.warehouse_id;

create view public.v_movement with (security_invoker = true) as
select m.id, m.posted_at, m.doc_type, m.doc_no, m.document_id, m.qty_in, m.qty_out,
       m.item_id, i.code as item_code, i.name as item_name,
       m.location_id, l.code as location_code,
       m.warehouse_id, w.code as warehouse_code, u.full_name as posted_by_name
  from public.stock_movement m
  join public.item i on i.id = m.item_id
  join public.location l on l.id = m.location_id
  join public.warehouse w on w.id = m.warehouse_id
  join public.app_user u on u.id = m.posted_by;

create view public.v_inbox with (security_invoker = true) as
select d.id, d.doc_type, d.doc_no, d.status, d.warehouse_id, d.created_by, d.submitted_at, s.step_role
  from public.document d
  join public.approval_step s
    on s.document_id = d.id and s.cycle = d.cycle and s.decision = 'PENDING'
   and s.step_order = (select min(x.step_order) from public.approval_step x
                        where x.document_id = d.id and x.cycle = d.cycle and x.decision = 'PENDING')
 where d.status in ('MENUNGGU_APPROVAL','MENUNGGU_VALIDASI')
   and d.created_by <> (select auth.uid())
   and ((s.step_role = 'KEPALA_DEPT' and exists (
           select 1 from public.department dp where dp.id = d.department_id
              and (select auth.uid()) in (dp.head_user_id, dp.deputy_user_id)))
     or (s.step_role = 'KEPALA_GUDANG' and exists (
           select 1 from public.warehouse w where w.id = d.warehouse_id
              and (select auth.uid()) in (w.head_user_id, w.deputy_user_id))));

-- SENGAJA tanpa security_invoker: pelacakan PO (UC-17) harus menampilkan angka yang sama untuk
-- Staff Departemen, gudang, dan kepala meski RLS menyembunyikan dokumen milik orang lain.
-- Hanya agregat per PO yang terbuka, dan hanya untuk user aktif.
create view public.v_production_po_progress as
select x.*, x.target_qty - x.received_qty as remaining_qty
  from (
    select po.id, po.po_number, po.status, po.target_qty,
           po.finished_item_id, i.code as finished_item_code, i.name as finished_item_name,
           coalesce((select sum(l.qty * case when d.reverses_document_id is null then 1 else -1 end)
                       from public.fg_receipt fr
                       join public.document d on d.id = fr.document_id and d.status = 'TERVALIDASI'
                       join public.document_line l on l.document_id = d.id
                      where fr.production_po_id = po.id), 0) as received_qty
      from public.production_po po join public.item i on i.id = po.finished_item_id) x
 where private.is_active_user();

-- idem v_production_po_progress (agregat per PO, user aktif saja)
create view public.v_po_material_taken as
select mr.production_po_id as po_id, l.item_id, i.code as item_code, i.name as item_name,
       sum(a.qty * case when d.reverses_document_id is null then 1 else -1 end) as qty
  from public.material_request mr
  join public.document d on d.id = mr.document_id and d.status = 'TERVALIDASI'
  join public.document_line l on l.document_id = d.id
  join public.document_line_alloc a on a.line_id = l.id
  join public.item i on i.id = l.item_id
 where mr.production_po_id is not null and private.is_active_user()
 group by mr.production_po_id, l.item_id, i.code, i.name;

create view public.v_stock_reconciliation with (security_invoker = true) as
select coalesce(b.item_id, m.item_id) as item_id, coalesce(b.location_id, m.location_id) as location_id,
       coalesce(b.qty, 0) as balance_qty, coalesce(m.net, 0) as ledger_qty
  from public.stock_balance b
  full join (select item_id, location_id, sum(qty_in - qty_out) as net
               from public.stock_movement group by item_id, location_id) m
    on m.item_id = b.item_id and m.location_id = b.location_id
 where coalesce(b.qty, 0) <> coalesce(m.net, 0);

create or replace function public.stock_card(
  p_item uuid, p_location uuid, p_from timestamptz, p_to timestamptz)
returns table (id bigint, posted_at timestamptz, doc_type text, doc_no text, document_id uuid,
               location_id uuid, qty_in numeric, qty_out numeric, saldo numeric)
language sql stable security invoker set search_path = '' as $$
  with opening as (
    select coalesce(sum(m.qty_in - m.qty_out), 0) as qty
      from public.stock_movement m
     where m.item_id = p_item and (p_location is null or m.location_id = p_location) and m.posted_at < p_from),
  rws as (
    select m.id, m.posted_at, m.doc_type, m.doc_no, m.document_id, m.location_id, m.qty_in, m.qty_out
      from public.stock_movement m
     where m.item_id = p_item and (p_location is null or m.location_id = p_location)
       and m.posted_at >= p_from and m.posted_at < p_to)
  -- baris pertama (id 0) = saldo awal periode
  select 0::bigint, p_from, 'SALDO_AWAL'::text, null::text, null::uuid, p_location,
         0::numeric, 0::numeric, o.qty
    from opening o
  union all
  select r.id, r.posted_at, r.doc_type, r.doc_no, r.document_id, r.location_id, r.qty_in, r.qty_out,
         (select qty from opening) + sum(r.qty_in - r.qty_out) over (order by r.id)
    from rws r
  order by 1
$$;

-- ---------- RLS ----------
alter table public.doc_counter          enable row level security;
alter table public.production_po        enable row level security;
alter table public.document             enable row level security;
alter table public.document_line        enable row level security;
alter table public.document_line_alloc  enable row level security;
alter table public.material_receipt     enable row level security;
alter table public.material_request     enable row level security;
alter table public.fg_receipt           enable row level security;
alter table public.delivery_note        enable row level security;
alter table public.stock_balance        enable row level security;
alter table public.stock_movement       enable row level security;
alter table public.approval_flow_config enable row level security;
alter table public.approval_step        enable row level security;
alter table public.notification         enable row level security;
alter table public.dashboard_config     enable row level security;

create policy document_read on public.document for select to authenticated
  using (private.is_active_user() and (
         created_by = (select auth.uid())
      or private.can_access_warehouse(warehouse_id)
      or exists (select 1 from public.department dp where dp.id = department_id
                   and (select auth.uid()) in (dp.head_user_id, dp.deputy_user_id))));

create policy document_line_read on public.document_line for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy document_alloc_read on public.document_line_alloc for select to authenticated
  using (exists (select 1 from public.document_line l where l.id = line_id));
create policy material_receipt_read on public.material_receipt for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy material_request_read on public.material_request for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy fg_receipt_read on public.fg_receipt for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy delivery_note_read on public.delivery_note for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));
create policy approval_step_read on public.approval_step for select to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));

create policy stock_balance_read on public.stock_balance for select to authenticated
  using (private.can_access_warehouse(warehouse_id) or private.has_perm('stock.read.all'));
create policy stock_movement_read on public.stock_movement for select to authenticated
  using (private.can_access_warehouse(warehouse_id) or private.has_perm('stock.read.all'));

create policy production_po_read on public.production_po for select to authenticated
  using (private.is_active_user());

create policy flow_config_read on public.approval_flow_config for select to authenticated
  using (private.is_active_user());

create policy notification_read on public.notification for select to authenticated
  using (user_id = (select auth.uid()));

create policy dashboard_config_read on public.dashboard_config for select to authenticated
  using (user_id = (select auth.uid()) or private.has_perm('dashboard.manage_all'));
create policy dashboard_config_insert on public.dashboard_config for insert to authenticated
  with check (user_id = (select auth.uid()) or private.has_perm('dashboard.manage_all'));
create policy dashboard_config_update on public.dashboard_config for update to authenticated
  using (user_id = (select auth.uid()) or private.has_perm('dashboard.manage_all'))
  with check (user_id = (select auth.uid()) or private.has_perm('dashboard.manage_all'));

-- jalur dokumen & stok: hanya lewat RPC (I2). Tidak ada hak tulis langsung.
revoke insert, update, delete, truncate on
  public.doc_counter, public.production_po, public.document, public.document_line,
  public.document_line_alloc, public.material_receipt, public.material_request,
  public.fg_receipt, public.delivery_note, public.stock_balance, public.stock_movement,
  public.approval_flow_config, public.approval_step, public.notification
  from authenticated;
revoke select on public.doc_counter from authenticated;

-- konfigurasi approval: tidak ada tulis langsung; ubah lewat set_flow_step_active()
-- hak EXECUTE: hanya user login, bukan anon/public
revoke execute on function public.save_draft(text, uuid, jsonb)            from public, anon;
revoke execute on function public.delete_draft(uuid)                       from public, anon;
revoke execute on function public.submit_document(uuid)                    from public, anon;
revoke execute on function public.decide_document(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.create_reversal(uuid, text)              from public, anon;
revoke execute on function public.mark_notifications_read(uuid[])          from public, anon;
revoke execute on function public.set_flow_step_active(text, int, boolean) from public, anon;
revoke execute on function public.stock_card(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_draft(text, uuid, jsonb)            to authenticated;
grant execute on function public.delete_draft(uuid)                       to authenticated;
grant execute on function public.submit_document(uuid)                    to authenticated;
grant execute on function public.decide_document(uuid, text, text, jsonb) to authenticated;
grant execute on function public.create_reversal(uuid, text)              to authenticated;
grant execute on function public.mark_notifications_read(uuid[])          to authenticated;
grant execute on function public.set_flow_step_active(text, int, boolean) to authenticated;
grant execute on function public.stock_card(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- fungsi private tidak boleh dipanggil langsung oleh klien
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_active_user()           to authenticated;
grant execute on function private.has_perm(text)             to authenticated;
grant execute on function private.can_access_warehouse(uuid) to authenticated;

-- anon tidak boleh membaca apa pun
revoke all on all tables in schema public from anon;
