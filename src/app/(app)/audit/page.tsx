import { Alert, Badge, Button, Card, Empty, Field, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const ENTITIES = [
  "document", "item", "uom", "warehouse", "location", "party", "department", "app_user", "user_warehouse", "approval_flow_config",
];

type Json = Record<string, unknown> | null;

/** Ringkasan perubahan: daftar field yang berubah (UPDATE) atau isi singkat (INSERT/DELETE). */
function summarize(action: string, before: Json, after: Json): string {
  const show = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
  if (action === "UPDATE" && before && after) {
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    return changed.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`).join("; ") || "(tidak ada perubahan nilai)";
  }
  const src = after ?? before;
  if (!src) return "";
  return Object.entries(src).filter(([k]) => k !== "id").slice(0, 6).map(([k, v]) => `${k}: ${show(v)}`).join("; ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  await requireAnyPerm("audit.read");
  const { entity } = await searchParams;
  const supabase = await createClient();

  let q = supabase
    .from("audit_log")
    .select("id, at, actor_id, action, entity_type, entity_id, before, after")
    .order("id", { ascending: false })
    .limit(200);
  if (entity && ENTITIES.includes(entity)) q = q.eq("entity_type", entity);
  const [{ data: logs }, { count: mismatches }] = await Promise.all([
    q,
    supabase.from("v_stock_reconciliation").select("item_id", { count: "exact", head: true }),
  ]);

  const actorIds = [...new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from("app_user").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const name = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  return (
    <>
      <PageHeader title="Audit Trail" subtitle="Siapa mengubah apa dan kapan: master data, konfigurasi approval, dan keputusan dokumen. Tidak bisa diubah dari aplikasi." />
      {mismatches === 0 ? (
        <Alert tone="success" className="mb-5">Rekonsiliasi stok: saldo seluruh penempatan sama dengan jumlah ledger. Tidak ada selisih.</Alert>
      ) : (
        <Alert tone="error" className="mb-5">
          Rekonsiliasi stok menemukan <b>{mismatches}</b> selisih antara saldo dan ledger. Ini tidak boleh terjadi; segera periksa.
        </Alert>
      )}
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Objek" className="w-64">
          <Select name="entity" defaultValue={entity ?? ""}>
            <option value="">Semua</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">Terapkan</Button>
      </form>
      <Card>
        {!logs?.length ? (
          <Empty>Belum ada catatan.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Waktu</Th><Th>Pengguna</Th><Th>Aksi</Th><Th>Objek</Th><Th>Perubahan</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(l.at)}</Td>
                  <Td>{l.actor_id ? (name.get(l.actor_id) ?? "—") : <span className="text-slate-400">sistem</span>}</Td>
                  <Td><Badge tone={l.action === "DELETE" ? "red" : l.action === "INSERT" ? "green" : "blue"}>{l.action}</Badge></Td>
                  <Td>{l.entity_type}</Td>
                  <Td className="max-w-xl break-words text-xs text-slate-600">{summarize(l.action, l.before as Json, l.after as Json)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
