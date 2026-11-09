"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveUserAction } from "@/app/actions/master";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

export function UserForm({
  id,
  initial,
  roles,
  departments,
  warehouses,
}: {
  id: string | null;
  initial: {
    username: string;
    fullName: string;
    roleId: string;
    departmentId: string;
    isActive: boolean;
    warehouseIds: string[];
  };
  roles: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveUserAction({
        id,
        username: id ? undefined : v.username,
        fullName: v.fullName,
        roleId: v.roleId,
        departmentId: v.departmentId || null,
        password: password || undefined,
        isActive: v.isActive,
        warehouseIds: v.warehouseIds,
      });
      if (!r.ok) return setError(r.error.message);
      router.push("/master/users");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Username" required={!id} hint={id ? "Tidak bisa diubah." : "Huruf kecil, angka, titik, strip, underscore."}>
        <Input value={v.username} disabled={Boolean(id)} autoCapitalize="none" onChange={(e) => setV({ ...v, username: e.target.value })} />
      </Field>
      <Field label="Nama lengkap" required>
        <Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
      </Field>
      <Field label="Peran" required>
        <Select value={v.roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>
          <option value="">— Pilih peran —</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      <Field label="Departemen" hint="Menentukan Kepala Departemen yang menyetujui dokumen user ini.">
        <Select value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}>
          <option value="">— Tidak ada —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Akses gudang</legend>
        <div className="space-y-1">
          {warehouses.map((w) => (
            <label key={w.id} className="flex min-h-[36px] items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={v.warehouseIds.includes(w.id)}
                onChange={(e) =>
                  setV({ ...v, warehouseIds: e.target.checked ? [...v.warehouseIds, w.id] : v.warehouseIds.filter((x) => x !== w.id) })
                }
              />
              {w.code} — {w.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Kepala Gudang juga ditetapkan pada master Gudang. Staff Departemen tidak perlu akses gudang.</p>
      </fieldset>
      <Field
        label={id ? "Password baru (opsional)" : "Password awal"}
        required={!id}
        hint="Minimal 10 karakter."
      >
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        Aktif
      </label>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan"}</Button>
        {id && <Link href="/master/users" className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-600 hover:underline">Batal edit</Link>}
      </div>
    </form>
  );
}
