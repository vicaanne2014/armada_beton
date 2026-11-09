"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveDashboardAction } from "@/app/actions/master";
import { Alert, Button, Card, Field, Select } from "@/components/ui";

export function DashboardSettings({
  userId,
  widgets,
  selected,
  warehouses,
  warehouseId,
}: {
  userId: string;
  widgets: Array<{ key: string; label: string; description: string }>;
  selected: string[];
  warehouses: Array<{ id: string; code: string; name: string }>;
  warehouseId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [keys, setKeys] = useState<string[]>(selected);
  const [wh, setWh] = useState(warehouseId);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="Widget yang ditampilkan">
        <div className="space-y-3">
          {widgets.map((w) => (
            <label key={w.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={keys.includes(w.key)}
                onChange={(e) => setKeys((k) => (e.target.checked ? [...k, w.key] : k.filter((x) => x !== w.key)))}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">{w.label}</span>
                <span className="block text-xs text-slate-500">{w.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card title="Filter">
        <Field label="Gudang" hint="Berlaku untuk widget stok, aktivitas, dan mutasi. Tetap dibatasi hak akses Anda.">
          <Select value={wh} onChange={(e) => setWh(e.target.value)} className="max-w-sm">
            <option value="">Semua gudang</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </Select>
        </Field>
      </Card>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await saveDashboardAction({ userId, keys, warehouseId: wh || null });
            if (!r.ok) return setMsg({ tone: "error", text: r.error.message });
            setMsg({ tone: "success", text: "Dashboard disimpan." });
            router.refresh();
          })
        }
      >
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </div>
  );
}
