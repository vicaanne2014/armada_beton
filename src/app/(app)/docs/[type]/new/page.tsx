import { notFound } from "next/navigation";
import { DocForm } from "@/components/doc-form";
import { OpnameOpenForm } from "@/components/opname-open-form";
import { Alert, PageHeader } from "@/components/ui";
import { docTypeBySlug } from "@/lib/domain/doc-types";
import { buildLocationLabels, getLookups, getMyWarehouseIds } from "@/lib/lookups";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function NewDocPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const def = docTypeBySlug(type);
  if (!def) notFound();
  const s = await requireSession();
  if (!s.can(def.createPerm)) notFound();

  const supabase = await createClient();

  if (def.type === "STOCK_OPNAME") {
    const mine = await getMyWarehouseIds(supabase, s.userId);
    const [{ data: whs }, { data: locs }, { data: locks }] = await Promise.all([
      supabase.from("warehouse").select("id, code, name").eq("is_active", true).order("code"),
      supabase.from("location").select("id, warehouse_id, parent_id, code, name").eq("is_active", true),
      supabase.from("opname_lock").select("location_id"),
    ]);
    const labels = buildLocationLabels(locs ?? []);
    const locked = new Set((locks ?? []).map((l) => l.location_id));
    const warehouses = (whs ?? []).filter((w) => mine.includes(w.id));
    return (
      <>
        <PageHeader title="Stock Opname Baru" subtitle="Hitung stok fisik per penempatan, bandingkan dengan sistem, lalu ajukan selisihnya untuk disetujui." />
        {!warehouses.length ? (
          <Alert tone="warn">Anda belum ditugaskan ke gudang mana pun. Hubungi Admin.</Alert>
        ) : (
          <OpnameOpenForm
            warehouses={warehouses}
            locations={(locs ?? []).map((l) => ({
              id: l.id,
              warehouse_id: l.warehouse_id,
              label: labels.get(l.id) ?? l.code,
              locked: locked.has(l.id),
            }))}
          />
        )}
      </>
    );
  }

  const [lookups, mine] = await Promise.all([
    getLookups(supabase),
    def.requiresMembership ? getMyWarehouseIds(supabase, s.userId) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={`${def.label} Baru`} subtitle="Stok baru berubah setelah dokumen disetujui dan divalidasi Kepala Gudang." />
      {def.type === "MATERIAL_RECEIPT" && (
        <Alert tone="info" className="mb-5">
          Foto atau PDF surat jalan masuk dilampirkan setelah draft disimpan (di halaman dokumen, maksimal 5 berkas).
        </Alert>
      )}
      <DocForm
        def={{
          type: def.type as Exclude<typeof def.type, "STOCK_OPNAME">,
          slug: def.slug,
          label: def.label,
          warehouseCategory: def.warehouseCategory,
          headerFields: def.headerFields,
          lines: def.lines,
        }}
        lookups={lookups}
        allowedWarehouseIds={mine}
      />
    </>
  );
}
