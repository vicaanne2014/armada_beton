"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { openOpnameAction } from "@/app/actions/opname";
import { Alert, Button, Card, Field, Select, Textarea } from "@/components/ui";

export interface OpnameLocation {
  id: string;
  warehouse_id: string;
  label: string;
  /** sedang dihitung sesi lain */
  locked: boolean;
}

export function OpnameOpenForm({
  warehouses,
  locations,
}: {
  warehouses: Array<{ id: string; code: string; name: string }>;
  locations: OpnameLocation[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [selected, setSelected] = useState<string[]>([]);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => locations.filter((l) => l.warehouse_id === warehouseId).sort((a, b) => a.label.localeCompare(b.label)),
    [locations, warehouseId],
  );

  function submit() {
    setError(null);
    start(async () => {
      const r = await openOpnameAction({ warehouseId, locationIds: selected, includeChildren, note: note || undefined });
      if (!r.ok) return setError(r.error.message);
      router.push(`/docs/stock-opnames/${r.data.id}/edit`);
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="info">
        Saat sesi dibuka, stok sistem pada penempatan terpilih disalin sebagai <b>snapshot</b> dan penempatan tersebut
        <b> dikunci</b>: transaksi lain pada penempatan itu tertahan sampai opname selesai (tervalidasi, ditolak, atau dibatalkan).
        Pilih hanya penempatan yang benar-benar akan dihitung sekarang.
      </Alert>
      <Card title="Lingkup Opname">
        <div className="space-y-4">
          <Field label="Gudang" required>
            <Select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setSelected([]);
              }}
              className="max-w-md"
            >
              <option value="">— Pilih gudang —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </Select>
          </Field>

          {warehouseId && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Penempatan yang dihitung</legend>
              {!options.length ? (
                <p className="text-sm text-slate-500">Gudang ini belum memiliki penempatan.</p>
              ) : (
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-3">
                  {options.map((l) => (
                    <label key={l.id} className={`flex min-h-[36px] items-center gap-2 text-sm ${l.locked ? "text-slate-400" : "text-slate-800"}`}>
                      <input
                        type="checkbox"
                        disabled={l.locked}
                        checked={selected.includes(l.id)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))}
                      />
                      {l.label}
                      {l.locked && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">sedang dihitung</span>}
                    </label>
                  ))}
                </div>
              )}
              <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
                Sertakan seluruh penempatan di bawahnya (mis. rak di dalam zona)
              </label>
            </fieldset>
          )}

          <Field label="Catatan sesi">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. opname bulanan Zona A" />
          </Field>
        </div>
      </Card>
      <Button disabled={pending || !warehouseId || selected.length === 0} onClick={submit}>
        {pending ? "Membuka sesi..." : "Mulai Opname"}
      </Button>
    </div>
  );
}
