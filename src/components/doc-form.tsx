"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveDraftAction, type WarningView } from "@/app/actions/documents";
import { Alert, Button, Card, Field, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import type { HeaderField } from "@/lib/domain/doc-types";
import type { Lookups } from "@/lib/lookups";

export interface LineState {
  item_id: string;
  qty: string;
  location_id: string;
  to_location_id: string;
}

export interface DocFormDef {
  type: "MATERIAL_RECEIPT" | "MATERIAL_REQUEST" | "STOCK_TRANSFER" | "FG_RECEIPT" | "DELIVERY_NOTE";
  slug: string;
  label: string;
  warehouseCategory: "MATERIAL" | "FINISHED_GOOD" | "ANY";
  headerFields: HeaderField[];
  lines: { location: boolean; locationLabel: string; toLocation: boolean };
}

interface Props {
  def: DocFormDef;
  lookups: Lookups;
  /** gudang yang boleh dipilih; null = semua gudang yang sesuai kategori */
  allowedWarehouseIds: string[] | null;
  initial?: {
    id: string;
    warehouseId: string;
    header: Record<string, string>;
    lines: LineState[];
    docNo: string | null;
    status: string;
    returnReason?: string | null;
  };
}

const emptyLine = (): LineState => ({ item_id: "", qty: "", location_id: "", to_location_id: "" });
const today = () => new Date().toISOString().slice(0, 10);

export function DocForm({ def, lookups, allowedWarehouseIds, initial }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const editing = Boolean(initial);

  const warehouses = useMemo(
    () =>
      lookups.warehouses.filter(
        (w) =>
          (def.warehouseCategory === "ANY" || w.category === def.warehouseCategory) &&
          (allowedWarehouseIds === null || allowedWarehouseIds.includes(w.id)),
      ),
    [lookups.warehouses, def.warehouseCategory, allowedWarehouseIds],
  );

  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? (warehouses.length === 1 ? warehouses[0].id : ""));
  const [header, setHeader] = useState<Record<string, string>>(() => {
    const h: Record<string, string> = { note: "", ...(initial?.header ?? {}) };
    if (!initial) for (const f of def.headerFields) if (f.kind === "date" && f.name !== "po_date") h[f.name] = today();
    return h;
  });
  const [lines, setLines] = useState<LineState[]>(initial?.lines?.length ? initial.lines : [emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; docNo?: string; warnings: WarningView[] } | null>(null);

  const warehouse = lookups.warehouses.find((w) => w.id === warehouseId);
  const items = lookups.items.filter((i) => warehouse && i.item_type === warehouse.category);
  const fgItems = lookups.items.filter((i) => i.item_type === "FINISHED_GOOD");
  const locations = lookups.locations.filter((l) => l.warehouse_id === warehouseId);
  const itemById = new Map(lookups.items.map((i) => [i.id, i]));

  const setH = (name: string, value: string) => setHeader((h) => ({ ...h, [name]: value }));
  const setLine = (idx: number, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  function changeWarehouse(id: string) {
    setWarehouseId(id);
    // item dan penempatan milik gudang sebelumnya tidak berlaku lagi
    setLines([emptyLine()]);
  }

  function save(submit: boolean) {
    setError(null);
    if (!warehouseId) return setError("Pilih gudang terlebih dahulu.");
    start(async () => {
      const res = await saveDraftAction({
        docType: def.type,
        docId: initial?.id ?? null,
        header: { ...header, warehouse_id: warehouseId },
        lines,
        submit,
      });
      if (!res.ok) {
        setError(
          res.savedId
            ? `Draft tersimpan, tetapi pengajuan gagal: ${res.error.message}`
            : res.error.message,
        );
        if (res.savedId && !initial) router.replace(`/docs/${def.slug}/${res.savedId}/edit`);
        return;
      }
      if (res.data.warnings.length > 0) {
        setResult({ id: res.data.id, docNo: res.data.docNo, warnings: res.data.warnings });
        return;
      }
      router.push(`/docs/${def.slug}/${res.data.id}`);
    });
  }

  if (result) {
    return (
      <Card title={`Dokumen ${result.docNo ?? ""} diajukan`}>
        <Alert tone="warn" className="mb-4">
          <p className="mb-2 font-medium">Perhatian:</p>
          <ul className="list-disc space-y-1 pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
        <Link href={`/docs/${def.slug}/${result.id}`} className="font-medium text-blue-700 underline">
          Lihat dokumen
        </Link>
      </Card>
    );
  }

  const renderHeader = (f: HeaderField) => {
    const value = header[f.name] ?? "";
    const common = { value, onChange: (e: { target: { value: string } }) => setH(f.name, e.target.value) };
    let control: React.ReactNode;
    if (f.kind === "party") {
      const opts = lookups.parties.filter((p) => p.party_type === "BOTH" || !f.party || p.party_type === f.party);
      control = (
        <Select {...common}>
          <option value="">— Pilih —</option>
          {opts.map((p) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </Select>
      );
    } else if (f.kind === "fgitem") {
      control = (
        <Select {...common}>
          <option value="">— Pilih produk —</option>
          {fgItems.map((i) => (
            <option key={i.id} value={i.id}>{i.code} — {i.name} ({i.uom})</option>
          ))}
        </Select>
      );
    } else if (f.kind === "po") {
      control = (
        <Select {...common}>
          <option value="">— Pilih PO produksi —</option>
          {lookups.pos.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </Select>
      );
    } else if (f.kind === "textarea") {
      control = <Textarea {...common} />;
    } else if (f.kind === "number") {
      control = <Input {...common} inputMode="decimal" />;
    } else {
      control = <Input {...common} type={f.kind === "date" ? "date" : "text"} />;
    }
    return (
      <Field key={f.name} label={f.label} hint={f.hint} required={f.required}>
        {control}
      </Field>
    );
  };

  return (
    <div className="space-y-6">
      {initial?.returnReason && (
        <Alert tone="warn">
          <span className="font-medium">Dikembalikan:</span> {initial.returnReason}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <Card title="Informasi Dokumen">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Gudang" required>
            <Select value={warehouseId} onChange={(e) => changeWarehouse(e.target.value)} disabled={editing}>
              <option value="">— Pilih gudang —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </Select>
          </Field>
          {def.headerFields.map(renderHeader)}
          <Field label="Catatan" className="md:col-span-2">
            <Textarea value={header.note ?? ""} onChange={(e) => setH("note", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title="Daftar Item"
        action={
          <Button type="button" variant="secondary" onClick={() => setLines((l) => [...l, emptyLine()])} disabled={!warehouseId}>
            + Tambah baris
          </Button>
        }
      >
        {!warehouseId ? (
          <p className="text-sm text-slate-500">Pilih gudang untuk menampilkan item dan penempatan.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Item</Th>
                <Th>Qty</Th>
                {def.lines.location && <Th>{def.lines.locationLabel}</Th>}
                {def.lines.toLocation && <Th>Ke penempatan</Th>}
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <Td className="w-8 text-slate-500">{idx + 1}</Td>
                  <Td className="min-w-56">
                    <Select value={l.item_id} onChange={(e) => setLine(idx, { item_id: e.target.value })}>
                      <option value="">— Pilih item —</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td className="w-40">
                    <div className="flex items-center gap-2">
                      <Input
                        value={l.qty}
                        inputMode="decimal"
                        placeholder="0"
                        onChange={(e) => setLine(idx, { qty: e.target.value })}
                      />
                      <span className="text-xs text-slate-500">{itemById.get(l.item_id)?.uom}</span>
                    </div>
                  </Td>
                  {def.lines.location && (
                    <Td className="min-w-56">
                      <Select value={l.location_id} onChange={(e) => setLine(idx, { location_id: e.target.value })}>
                        <option value="">— Pilih penempatan —</option>
                        {locations.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </Select>
                    </Td>
                  )}
                  {def.lines.toLocation && (
                    <Td className="min-w-56">
                      <Select value={l.to_location_id} onChange={(e) => setLine(idx, { to_location_id: e.target.value })}>
                        <option value="">— Pilih penempatan —</option>
                        {locations.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </Select>
                    </Td>
                  )}
                  <Td className="w-12">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2"
                      aria-label={`Hapus baris ${idx + 1}`}
                      onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((_, i) => i !== idx)))}
                    >
                      ✕
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {def.type === "MATERIAL_REQUEST" && (
          <p className="mt-3 text-xs text-slate-500">
            Penempatan sumber material dipilih oleh Kepala Gudang saat validasi. Stok baru berkurang setelah validasi.
          </p>
        )}
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => save(false)}>
          {pending ? "Menyimpan..." : "Simpan Draft"}
        </Button>
        <Button type="button" disabled={pending} onClick={() => save(true)}>
          {pending ? "Memproses..." : "Simpan & Ajukan"}
        </Button>
        <Link href={`/docs/${def.slug}`} className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-600 hover:underline">
          Batal
        </Link>
      </div>
    </div>
  );
}
