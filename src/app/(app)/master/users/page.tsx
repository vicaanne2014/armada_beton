import Link from "next/link";
import { UserForm } from "@/components/user-form";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { first } from "@/lib/documents";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requireAnyPerm("user.manage");
  const { edit } = await searchParams;
  const supabase = await createClient();

  const [{ data: users }, { data: roles }, { data: depts }, { data: whs }, { data: access }] = await Promise.all([
    supabase
      .from("app_user")
      .select("id, username, full_name, is_active, role_id, department_id, role:app_role(name), department:department(name)")
      .order("full_name"),
    supabase.from("app_role").select("id, name").order("name"),
    supabase.from("department").select("id, name").eq("is_active", true).order("name"),
    supabase.from("warehouse").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("user_warehouse").select("user_id, warehouse:warehouse(code)"),
  ]);

  const accessBy = new Map<string, string[]>();
  for (const a of access ?? []) {
    const code = first(a.warehouse as unknown as { code: string } | null)?.code;
    if (code) accessBy.set(a.user_id, [...(accessBy.get(a.user_id) ?? []), code]);
  }
  const accessIds = new Map<string, string[]>();
  const { data: accessRaw } = await supabase.from("user_warehouse").select("user_id, warehouse_id");
  for (const a of accessRaw ?? []) accessIds.set(a.user_id, [...(accessIds.get(a.user_id) ?? []), a.warehouse_id]);

  const current = edit ? (users ?? []).find((u) => u.id === edit) : undefined;

  return (
    <>
      <PageHeader title="Pengguna" subtitle="Akun login, peran, departemen, dan akses gudang. Pengguna dinonaktifkan, tidak dihapus, supaya jejak audit tetap utuh." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            {!users?.length ? (
              <Empty>Belum ada pengguna.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Nama</Th><Th>Username</Th><Th>Peran</Th><Th>Departemen</Th><Th>Gudang</Th><Th>Status</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className={u.id === edit ? "bg-blue-50" : "hover:bg-slate-50"}>
                      <Td>{u.full_name}</Td>
                      <Td>{u.username}</Td>
                      <Td>{first(u.role as unknown as { name: string } | null)?.name}</Td>
                      <Td>{first(u.department as unknown as { name: string } | null)?.name ?? "-"}</Td>
                      <Td>{(accessBy.get(u.id) ?? []).join(", ") || "-"}</Td>
                      <Td>{u.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</Td>
                      <Td><Link href={`/master/users?edit=${u.id}`} className="text-blue-700 hover:underline">Ubah</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title={current ? "Ubah Pengguna" : "Tambah Pengguna"}>
          <UserForm
            key={edit ?? "new"}
            id={current?.id ?? null}
            roles={roles ?? []}
            departments={depts ?? []}
            warehouses={whs ?? []}
            initial={{
              username: current?.username ?? "",
              fullName: current?.full_name ?? "",
              roleId: current?.role_id ?? "",
              departmentId: current?.department_id ?? "",
              isActive: current?.is_active ?? true,
              warehouseIds: current ? (accessIds.get(current.id) ?? []) : [],
            }}
          />
        </Card>
      </div>
    </>
  );
}
