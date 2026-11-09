-- =====================================================================
-- 0001 CORE: master data, profil user, RBAC, helper, audit
-- Aturan umum (lihat docs/Technical Logic):
--  * Semua tabel ENABLE ROW LEVEL SECURITY.
--  * Fungsi bantu berhak tinggi ada di schema private (tidak terekspos PostgREST).
--  * Otorisasi dibaca dari tabel (bukan user_metadata) lewat auth.uid().
-- =====================================================================

create schema if not exists private;

-- ---------- error domain ----------
-- Semua pelanggaran aturan bisnis memakai pesan = KODE, errcode P0001,
-- detail = JSON. Server Action memetakan KODE -> pesan Indonesia.
create or replace function private.fail(p_code text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = p_detail::text;
end $$;

create or replace function private.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_TABLE' using errcode = 'P0001';
end $$;

-- ---------- RBAC ----------
create table public.app_role (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table public.permission (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text
);

create table public.role_permission (
  role_id uuid not null references public.app_role(id) on delete cascade,
  permission_id uuid not null references public.permission(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ---------- organisasi ----------
create table public.department (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  head_user_id uuid,
  deputy_user_id uuid,
  is_active boolean not null default true
);

create table public.app_user (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username)),
  full_name text not null,
  role_id uuid not null references public.app_role(id),
  department_id uuid references public.department(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.department
  add constraint department_head_fk   foreign key (head_user_id)   references public.app_user(id),
  add constraint department_deputy_fk foreign key (deputy_user_id) references public.app_user(id);

-- ---------- gudang & penempatan ----------
create table public.warehouse (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in ('MATERIAL','FINISHED_GOOD')),
  head_user_id uuid references public.app_user(id),
  deputy_user_id uuid references public.app_user(id),
  is_active boolean not null default true
);

create table public.user_warehouse (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user(id) on delete cascade,
  warehouse_id uuid not null references public.warehouse(id) on delete cascade,
  unique (user_id, warehouse_id)
);

create table public.location (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouse(id),
  parent_id uuid,
  code text not null,
  name text not null,
  type_label text,
  is_active boolean not null default true,
  unique (warehouse_id, code),
  unique (id, warehouse_id),
  -- induk wajib berada di gudang yang sama
  foreign key (parent_id, warehouse_id) references public.location(id, warehouse_id)
);

-- ---------- satuan & item ----------
create table public.uom (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  uom_type text not null check (uom_type in ('MATERIAL','FINISHED_GOOD')),
  is_active boolean not null default true,
  unique (id, uom_type)
);

create table public.item (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  item_type text not null check (item_type in ('MATERIAL','FINISHED_GOOD')),
  uom_id uuid not null,
  min_stock numeric(18,4) check (min_stock is null or min_stock >= 0),
  is_active boolean not null default true,
  -- jenis satuan harus sama dengan jenis item (FR-24), ditegakkan database
  foreign key (uom_id, item_type) references public.uom(id, uom_type)
);

-- ---------- pihak luar & PO referensi ----------
create table public.party (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  party_type text not null check (party_type in ('CUSTOMER','SUPPLIER','BOTH')),
  address text,
  is_active boolean not null default true
);

create table public.po_reference (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  party_id uuid not null references public.party(id),
  po_date date,
  unique (po_number, party_id)
);

-- ---------- audit log ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_at_idx on public.audit_log (at desc);

create trigger audit_log_no_mutation before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.forbid_mutation();

create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor_id, action, entity_type, entity_id, before, after)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_before, p_after);
end $$;

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor_id, action, entity_type, entity_id, before, after)
  values ((select auth.uid()), tg_op, tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

-- ---------- fungsi bantu otorisasi ----------
create or replace function private.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_user u
                 where u.id = (select auth.uid()) and u.is_active)
$$;

create or replace function private.has_perm(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.app_user u
    join public.role_permission rp on rp.role_id = u.role_id
    join public.permission pm on pm.id = rp.permission_id
    where u.id = (select auth.uid()) and u.is_active and pm.code = p)
$$;

create or replace function private.can_access_warehouse(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and (
       private.has_perm('report.read.all')
    or exists (select 1 from public.user_warehouse uw
               where uw.user_id = (select auth.uid()) and uw.warehouse_id = w)
    or exists (select 1 from public.warehouse wh
               where wh.id = w and (select auth.uid()) in (wh.head_user_id, wh.deputy_user_id)))
$$;

-- ---------- trigger aturan master ----------
-- Penempatan: tidak boleh siklus; tidak boleh nonaktif bila masih berisi stok (BR-09)
create or replace function private.guard_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id and new.parent_id is not null then
    if exists (
      with recursive anc(id, parent_id) as (
        select l.id, l.parent_id from public.location l where l.id = new.parent_id
        union all
        select l.id, l.parent_id from public.location l join anc a on l.id = a.parent_id)
      select 1 from anc where id = new.id) then
      perform private.fail('LOCATION_CYCLE');
    end if;
  end if;
  if tg_op = 'UPDATE' and old.is_active and not new.is_active then
    if exists (select 1 from public.stock_balance b where b.location_id = old.id and b.qty > 0) then
      perform private.fail('LOCATION_HAS_STOCK');
    end if;
  end if;
  return new;
end $$;
create trigger location_guard before update on public.location
  for each row execute function private.guard_location();

-- Item: satuan terkunci setelah ada pergerakan; tidak nonaktif bila masih ada stok (BR-16)
create or replace function private.guard_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.uom_id is distinct from old.uom_id
     and exists (select 1 from public.stock_movement m where m.item_id = old.id) then
    perform private.fail('ITEM_UOM_LOCKED');
  end if;
  if new.item_type is distinct from old.item_type
     and exists (select 1 from public.stock_movement m where m.item_id = old.id) then
    perform private.fail('ITEM_TYPE_LOCKED');
  end if;
  if old.is_active and not new.is_active
     and exists (select 1 from public.stock_balance b where b.item_id = old.id and b.qty > 0) then
    perform private.fail('ITEM_HAS_STOCK');
  end if;
  return new;
end $$;
create trigger item_guard before update on public.item
  for each row execute function private.guard_item();

-- Satuan: tidak boleh nonaktif bila dipakai item aktif
create or replace function private.guard_uom() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_active and not new.is_active
     and exists (select 1 from public.item i where i.uom_id = old.id and i.is_active) then
    perform private.fail('UOM_IN_USE');
  end if;
  if new.uom_type is distinct from old.uom_type
     and exists (select 1 from public.item i where i.uom_id = old.id) then
    perform private.fail('UOM_TYPE_LOCKED');
  end if;
  return new;
end $$;
create trigger uom_guard before update on public.uom
  for each row execute function private.guard_uom();

-- Gudang: kategori terkunci setelah ada dokumen
create or replace function private.guard_warehouse() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category is distinct from old.category
     and exists (select 1 from public.document d where d.warehouse_id = old.id) then
    perform private.fail('WAREHOUSE_CATEGORY_LOCKED');
  end if;
  return new;
end $$;
create trigger warehouse_guard before update on public.warehouse
  for each row execute function private.guard_warehouse();

-- ---------- audit trigger pada master ----------
create trigger audit_department  after insert or update or delete on public.department     for each row execute function private.audit_row();
create trigger audit_app_user    after insert or update or delete on public.app_user       for each row execute function private.audit_row();
create trigger audit_warehouse   after insert or update or delete on public.warehouse      for each row execute function private.audit_row();
create trigger audit_user_wh     after insert or update or delete on public.user_warehouse for each row execute function private.audit_row();
create trigger audit_location    after insert or update or delete on public.location       for each row execute function private.audit_row();
create trigger audit_uom         after insert or update or delete on public.uom            for each row execute function private.audit_row();
create trigger audit_item        after insert or update or delete on public.item           for each row execute function private.audit_row();
create trigger audit_party       after insert or update or delete on public.party          for each row execute function private.audit_row();

-- ---------- RLS master ----------
alter table public.app_role        enable row level security;
alter table public.permission      enable row level security;
alter table public.role_permission enable row level security;
alter table public.department      enable row level security;
alter table public.app_user        enable row level security;
alter table public.warehouse       enable row level security;
alter table public.user_warehouse  enable row level security;
alter table public.location        enable row level security;
alter table public.uom             enable row level security;
alter table public.item            enable row level security;
alter table public.party           enable row level security;
alter table public.po_reference    enable row level security;
alter table public.audit_log       enable row level security;

-- baca: semua user aktif (dibutuhkan untuk dropdown dan nama pada dokumen)
create policy app_role_read        on public.app_role        for select to authenticated using (private.is_active_user());
create policy permission_read      on public.permission      for select to authenticated using (private.is_active_user());
create policy role_permission_read on public.role_permission for select to authenticated using (private.is_active_user());
create policy department_read      on public.department      for select to authenticated using (private.is_active_user());
create policy app_user_read        on public.app_user        for select to authenticated using (private.is_active_user());
create policy warehouse_read       on public.warehouse       for select to authenticated using (private.is_active_user());
create policy user_warehouse_read  on public.user_warehouse  for select to authenticated using (private.is_active_user());
create policy location_read        on public.location        for select to authenticated using (private.is_active_user());
create policy uom_read             on public.uom             for select to authenticated using (private.is_active_user());
create policy item_read            on public.item            for select to authenticated using (private.is_active_user());
create policy party_read           on public.party           for select to authenticated using (private.is_active_user());
create policy po_reference_read    on public.po_reference    for select to authenticated using (private.is_active_user());

-- tulis master: permission master.manage
create policy department_write on public.department for all to authenticated
  using (private.has_perm('master.manage')) with check (private.has_perm('master.manage'));
create policy app_user_write on public.app_user for all to authenticated
  using (private.has_perm('user.manage')) with check (private.has_perm('user.manage'));
create policy warehouse_write on public.warehouse for all to authenticated
  using (private.has_perm('master.manage')) with check (private.has_perm('master.manage'));
create policy user_warehouse_write on public.user_warehouse for all to authenticated
  using (private.has_perm('user.manage')) with check (private.has_perm('user.manage'));
create policy uom_write on public.uom for all to authenticated
  using (private.has_perm('master.manage')) with check (private.has_perm('master.manage'));
create policy item_write on public.item for all to authenticated
  using (private.has_perm('master.manage')) with check (private.has_perm('master.manage'));
create policy party_write on public.party for all to authenticated
  using (private.has_perm('master.manage')) with check (private.has_perm('master.manage'));

-- penempatan: Admin, atau Kepala Gudang pada gudangnya
create policy location_write on public.location for all to authenticated
  using (private.has_perm('master.manage')
         or (private.has_perm('location.manage') and private.can_access_warehouse(warehouse_id)))
  with check (private.has_perm('master.manage')
         or (private.has_perm('location.manage') and private.can_access_warehouse(warehouse_id)));

-- RBAC dan PO referensi: hanya lewat fungsi/seed; audit hanya dibaca
create policy audit_log_read on public.audit_log for select to authenticated
  using (private.has_perm('audit.read'));

revoke insert, update, delete, truncate on public.app_role, public.permission, public.role_permission,
  public.po_reference, public.audit_log from authenticated;

-- izin pada schema private agar policy/fungsi bantu dapat dipanggil user login
grant usage on schema private to authenticated;
grant execute on function private.is_active_user()          to authenticated;
grant execute on function private.has_perm(text)            to authenticated;
grant execute on function private.can_access_warehouse(uuid) to authenticated;
