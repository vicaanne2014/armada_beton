-- =====================================================================
-- 0003 DATA REFERENSI: peran, permission, alur approval default
-- Idempotent. Matriks approval mengikuti dokumen requirement (hlm. 7).
-- =====================================================================

insert into public.app_role(code, name) values
  ('STAFF_GUDANG_MATERIAL', 'Staff Gudang Material'),
  ('STAFF_GUDANG_BJ',       'Staff Gudang Barang Jadi'),
  ('STAFF_DEPT',            'Staff Departemen'),
  ('KEPALA_DEPT',           'Kepala Departemen'),
  ('KEPALA_GUDANG',         'Kepala Gudang'),
  ('ADMIN',                 'Admin Sistem'),
  ('MANAJEMEN',             'Manajemen')
on conflict (code) do nothing;

insert into public.permission(code, description) values
  ('master.manage',                 'Kelola master gudang, item, satuan, pihak, departemen'),
  ('user.manage',                   'Kelola user dan penugasan gudang'),
  ('location.manage',               'Kelola penempatan pada gudang yang ditugaskan'),
  ('doc.create.material_receipt',   'Buat penerimaan material'),
  ('doc.create.material_request',  'Buat permintaan material'),
  ('doc.create.stock_transfer',     'Buat pemindahan penempatan'),
  ('doc.create.fg_receipt',         'Buat penerimaan barang jadi'),
  ('doc.create.delivery_note',      'Buat pengiriman barang jadi'),
  ('doc.create.reversal',           'Buat transaksi pembalik'),
  ('doc.decide',                    'Approve / validasi / tolak dokumen (otoritas ditentukan kepala dan deputi)'),
  ('approval_config.manage',        'Atur alur approval'),
  ('audit.read',                    'Lihat audit trail'),
  ('dashboard.manage_all',          'Atur dashboard user lain'),
  ('report.read.all',               'Baca data seluruh gudang'),
  ('stock.read.all',                'Baca stok seluruh gudang'),
  ('report.stock',                  'Laporan stok'),
  ('report.movement',               'Laporan mutasi / kartu stok'),
  ('report.documents',              'Laporan dokumen')
on conflict (code) do nothing;

insert into public.role_permission(role_id, permission_id)
select r.id, p.id
  from (values
    ('STAFF_GUDANG_MATERIAL','doc.create.material_receipt'),
    ('STAFF_GUDANG_MATERIAL','doc.create.stock_transfer'),
    ('STAFF_GUDANG_MATERIAL','doc.create.reversal'),
    ('STAFF_GUDANG_MATERIAL','report.stock'),
    ('STAFF_GUDANG_MATERIAL','report.movement'),
    ('STAFF_GUDANG_MATERIAL','report.documents'),

    ('STAFF_GUDANG_BJ','doc.create.fg_receipt'),
    ('STAFF_GUDANG_BJ','doc.create.delivery_note'),
    ('STAFF_GUDANG_BJ','doc.create.stock_transfer'),
    ('STAFF_GUDANG_BJ','doc.create.reversal'),
    ('STAFF_GUDANG_BJ','report.stock'),
    ('STAFF_GUDANG_BJ','report.movement'),
    ('STAFF_GUDANG_BJ','report.documents'),

    ('STAFF_DEPT','doc.create.material_request'),
    ('STAFF_DEPT','report.documents'),

    ('KEPALA_DEPT','doc.decide'),
    ('KEPALA_DEPT','stock.read.all'),
    ('KEPALA_DEPT','report.stock'),
    ('KEPALA_DEPT','report.documents'),

    ('KEPALA_GUDANG','doc.decide'),
    ('KEPALA_GUDANG','location.manage'),
    ('KEPALA_GUDANG','report.stock'),
    ('KEPALA_GUDANG','report.movement'),
    ('KEPALA_GUDANG','report.documents'),

    ('ADMIN','master.manage'),
    ('ADMIN','user.manage'),
    ('ADMIN','approval_config.manage'),
    ('ADMIN','audit.read'),
    ('ADMIN','dashboard.manage_all'),
    ('ADMIN','report.read.all'),
    ('ADMIN','stock.read.all'),
    ('ADMIN','report.stock'),
    ('ADMIN','report.movement'),
    ('ADMIN','report.documents'),

    ('MANAJEMEN','report.read.all'),
    ('MANAJEMEN','stock.read.all'),
    ('MANAJEMEN','audit.read'),
    ('MANAJEMEN','report.stock'),
    ('MANAJEMEN','report.movement'),
    ('MANAJEMEN','report.documents')
  ) as v(role_code, perm_code)
  join public.app_role r on r.code = v.role_code
  join public.permission p on p.code = v.perm_code
on conflict do nothing;

-- Alur default: Kepala Dept -> Kepala Gudang. Pindah penempatan tanpa approval (default).
insert into public.approval_flow_config(doc_type, step_order, step_role, is_active) values
  ('MATERIAL_RECEIPT', 1, 'KEPALA_DEPT',   true),
  ('MATERIAL_RECEIPT', 2, 'KEPALA_GUDANG', true),
  ('MATERIAL_REQUEST', 1, 'KEPALA_DEPT',   true),
  ('MATERIAL_REQUEST', 2, 'KEPALA_GUDANG', true),
  ('STOCK_TRANSFER',   1, 'KEPALA_DEPT',   false),
  ('STOCK_TRANSFER',   2, 'KEPALA_GUDANG', true),
  ('FG_RECEIPT',       1, 'KEPALA_DEPT',   true),
  ('FG_RECEIPT',       2, 'KEPALA_GUDANG', true),
  ('DELIVERY_NOTE',    1, 'KEPALA_DEPT',   true),
  ('DELIVERY_NOTE',    2, 'KEPALA_GUDANG', true)
on conflict (doc_type, step_order) do nothing;
