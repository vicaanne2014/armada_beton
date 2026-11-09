"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLocationAction } from "@/app/actions/master";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

export function LocationForm({
  warehouseId,
  id,
  initial,
  parentOptions,
}: {
  warehouseId: string;
  id: string | null;
  initial: { code: string; name: string; typeLabel: string; parentId: string; isActive: boolean };
  parentOptions: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveLocationAction({
        warehouseId,
        id,
        code: v.code,
        name: v.name,
        typeLabel: v.typeLabel,
        parentId: v.parentId || null,
        isActive: v.isActive,
      });
      if (!r.ok) return setError(r.error.message);
      router.push(`/master/locations?warehouse=${warehouseId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Induk (opsional)" hint="Kosongkan untuk penempatan tingkat atas (mis. zona).">
        <Select value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
          <option value="">— Tingkat atas —</option>
          {parentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <Field label="Kode" required hint="Unik di gudang ini. Dipakai untuk label QR kelak.">
        <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
      </Field>
      <Field label="Nama" required>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label="Tipe" hint="Teks bebas, mis. zona, aisle, rak.">
        <Input value={v.typeLabel} onChange={(e) => setV({ ...v, typeLabel: e.target.value })} />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        Aktif
      </label>
      <p className="text-xs text-slate-500">Penempatan yang masih berisi stok tidak bisa dinonaktifkan sebelum stoknya dipindah.</p>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan"}</Button>
        {id && (
          <Link href={`/master/locations?warehouse=${warehouseId}`} className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-600 hover:underline">
            Batal edit
          </Link>
        )}
      </div>
    </form>
  );
}
