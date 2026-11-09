import Link from "next/link";
import { notFound } from "next/navigation";
import { MasterForm, type FormField } from "@/components/master-form";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { MASTER } from "@/lib/master-config";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function MasterPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { entity } = await params;
  const { edit } = await searchParams;
  const def = MASTER[entity];
  if (!def) notFound();
  await requireAnyPerm("master.manage");
  const supabase = await createClient();

  const [{ data: rows }, users, depts, uoms] = await Promise.all([
    supabase.from(def.table).select(def.select).order(def.orderBy),
    def.fields.some((f) => f.optionsFrom === "users")
      ? supabase.from("app_user").select("id, full_name, username").eq("is_active", true).order("full_name")
      : Promise.resolve({ data: [] }),
    def.fields.some((f) => f.optionsFrom === "departments")
      ? supabase.from("department").select("id, name").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] }),
    def.fields.some((f) => f.optionsFrom === "uoms")
      ? supabase.from("uom").select("id, code, name, uom_type").eq("is_active", true).order("code")
      : Promise.resolve({ data: [] }),
  ]);

  const fields: FormField[] = def.fields.map((f) => {
    let options = f.options;
    if (f.optionsFrom === "users") options = (users.data ?? []).map((u) => ({ value: u.id, label: `${u.full_name} (${u.username})` }));
    if (f.optionsFrom === "departments") options = (depts.data ?? []).map((d) => ({ value: d.id, label: d.name }));
    if (f.optionsFrom === "uoms") options = (uoms.data ?? []).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}`, group: u.uom_type }));
    return { name: f.name, label: f.label, type: f.type, required: f.required, options, groupBy: f.groupBy, createOnly: f.createOnly, hint: f.hint };
  });

  const current = edit ? (rows ?? []).find((r) => (r as unknown as { id: string }).id === edit) : undefined;
  const initial: Record<string, string | boolean> = {};
  for (const f of def.fields) {
    const raw = current ? (current as unknown as Record<string, unknown>)[f.name] : undefined;
    initial[f.name] = f.type === "bool" ? (current ? Boolean(raw) : true) : raw === null || raw === undefined ? "" : String(raw);
  }

  return (
    <>
      <PageHeader title={def.title} subtitle={def.description} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            {!rows?.length ? (
              <Empty>Belum ada data.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    {def.cols.map((c) => <Th key={c.label}>{c.label}</Th>)}
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const row = r as unknown as Record<string, unknown> & { id: string };
                    return (
                      <tr key={row.id} className={row.id === edit ? "bg-blue-50" : "hover:bg-slate-50"}>
                        {def.cols.map((c) => {
                          const v = c.get(row);
                          return (
                            <Td key={c.label}>
                              {v === "Aktif" ? <Badge tone="green">Aktif</Badge> : v === "Nonaktif" ? <Badge>Nonaktif</Badge> : v}
                            </Td>
                          );
                        })}
                        <Td><Link href={`/master/${entity}?edit=${row.id}`} className="text-blue-700 hover:underline">Ubah</Link></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title={current ? `Ubah ${def.title}` : `Tambah ${def.title}`}>
          <MasterForm key={edit ?? "new"} entity={entity} fields={fields} id={current ? (current as unknown as { id: string }).id : null} initial={initial} />
        </Card>
      </div>
    </>
  );
}
