import Link from "next/link";
import { LocationForm } from "@/components/location-form";
import { Badge, Button, Card, Empty, Field, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { getMyWarehouseIds } from "@/lib/lookups";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

interface Loc {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  type_label: string | null;
  is_active: boolean;
}

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; edit?: string }>;
}) {
  const s = await requireAnyPerm("master.manage", "location.manage");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: all } = await supabase.from("warehouse").select("id, code, name").eq("is_active", true).order("code");
  // Kepala Gudang hanya mengelola gudangnya; Admin semua gudang
  const mine = s.can("master.manage") ? null : await getMyWarehouseIds(supabase, s.userId);
  const warehouses = (all ?? []).filter((w) => mine === null || mine.includes(w.id));
  const warehouseId = sp.warehouse && warehouses.some((w) => w.id === sp.warehouse) ? sp.warehouse : warehouses[0]?.id;

  if (!warehouseId) {
    return (
      <>
        <PageHeader title="Penempatan" />
        <Card><Empty>Belum ada gudang yang bisa Anda kelola.</Empty></Card>
      </>
    );
  }

  const { data } = await supabase
    .from("location")
    .select("id, parent_id, code, name, type_label, is_active")
    .eq("warehouse_id", warehouseId)
    .order("code");
  const locs = (data ?? []) as Loc[];

  const children = new Map<string | null, Loc[]>();
  for (const l of locs) {
    const k = l.parent_id && locs.some((x) => x.id === l.parent_id) ? l.parent_id : null;
    children.set(k, [...(children.get(k) ?? []), l]);
  }
  const ordered: Array<{ loc: Loc; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of children.get(parent) ?? []) {
      ordered.push({ loc: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);

  const current = sp.edit ? locs.find((l) => l.id === sp.edit) : undefined;
  const descendants = new Set<string>();
  if (current) {
    const collect = (id: string) => {
      for (const c of children.get(id) ?? []) {
        descendants.add(c.id);
        collect(c.id);
      }
    };
    collect(current.id);
  }
  const labelOf = new Map(ordered.map(({ loc, depth }) => [loc.id, `${"— ".repeat(depth)}${loc.name} (${loc.code})`]));
  const parentOptions = ordered
    .filter(({ loc }) => loc.id !== current?.id && !descendants.has(loc.id))
    .map(({ loc }) => ({ value: loc.id, label: labelOf.get(loc.id)! }));

  return (
    <>
      <PageHeader title="Penempatan" subtitle="Pohon lokasi bebas per gudang (zona, aisle, rak, dst). Struktur tidak dikunci di kode." />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Gudang" className="w-72">
          <Select name="warehouse" defaultValue={warehouseId}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">Tampilkan</Button>
      </form>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            {!ordered.length ? (
              <Empty>Belum ada penempatan di gudang ini.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Nama</Th><Th>Kode</Th><Th>Tipe</Th><Th>Status</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {ordered.map(({ loc, depth }) => (
                    <tr key={loc.id} className={loc.id === sp.edit ? "bg-blue-50" : "hover:bg-slate-50"}>
                      <Td><span style={{ paddingLeft: depth * 20 }}>{depth > 0 && "↳ "}{loc.name}</span></Td>
                      <Td>{loc.code}</Td>
                      <Td>{loc.type_label}</Td>
                      <Td>{loc.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</Td>
                      <Td><Link href={`/master/locations?warehouse=${warehouseId}&edit=${loc.id}`} className="text-blue-700 hover:underline">Ubah</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title={current ? "Ubah Penempatan" : "Tambah Penempatan"}>
          <LocationForm
            key={`${warehouseId}:${sp.edit ?? "new"}`}
            warehouseId={warehouseId}
            id={current?.id ?? null}
            parentOptions={parentOptions}
            initial={{
              code: current?.code ?? "",
              name: current?.name ?? "",
              typeLabel: current?.type_label ?? "",
              parentId: current?.parent_id ?? "",
              isActive: current?.is_active ?? true,
            }}
          />
        </Card>
      </div>
    </>
  );
}
