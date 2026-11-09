"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMasterAction } from "@/app/actions/master";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";

export interface FormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "bool";
  required?: boolean;
  options?: Array<{ value: string; label: string; group?: string }>;
  groupBy?: string;
  createOnly?: boolean;
  hint?: string;
}

export function MasterForm({
  entity,
  fields,
  id,
  initial,
}: {
  entity: string;
  fields: FormField[];
  id: string | null;
  initial: Record<string, string | boolean>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string | boolean>>(initial);
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveMasterAction(entity, id, values);
      if (!r.ok) return setError(r.error.message);
      router.push(`/master/${entity}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((f) => {
          const locked = Boolean(id && f.createOnly);
          const v = values[f.name];
          if (f.type === "bool") {
            return (
              <label key={f.name} className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            );
          }
          let control: React.ReactNode;
          if (f.type === "select") {
            const opts = (f.options ?? []).filter((o) => !f.groupBy || !o.group || o.group === values[f.groupBy]);
            control = (
              <Select value={String(v ?? "")} disabled={locked} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">{f.required ? "— Pilih —" : "— Tidak ada —"}</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            );
          } else if (f.type === "textarea") {
            control = <Textarea value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />;
          } else {
            control = (
              <Input
                value={String(v ?? "")}
                inputMode={f.type === "number" ? "decimal" : undefined}
                disabled={locked}
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
          }
          return (
            <Field key={f.name} label={f.label} required={f.required} hint={locked ? "Tidak bisa diubah setelah dibuat." : f.hint}>
              {control}
            </Field>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan"}</Button>
        {id && (
          <Link href={`/master/${entity}`} className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-600 hover:underline">
            Batal edit
          </Link>
        )}
      </div>
    </form>
  );
}
