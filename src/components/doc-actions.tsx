"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  decideAction,
  deleteDraftAction,
  reverseAction,
  submitAction,
  type WarningView,
} from "@/app/actions/documents";
import { cancelOpnameAction } from "@/app/actions/opname";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtQty } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Aksi pembuat: ajukan, edit, hapus draft, buat pembalik              */
/* ------------------------------------------------------------------ */
export function DocActions({
  docId,
  slug,
  canSubmit,
  canEdit,
  canDelete,
  canReverse,
  canCancelOpname = false,
  editLabel = "Ubah",
}: {
  docId: string;
  slug: string;
  canSubmit: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReverse: boolean;
  canCancelOpname?: boolean;
  editLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<WarningView[]>([]);
  const [reversing, setReversing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<void>) => {
    setError(null);
    start(fn);
  };

  if (!canSubmit && !canEdit && !canDelete && !canReverse && !canCancelOpname) return null;

  return (
    <Card title="Aksi">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {warnings.length > 0 && (
          <Alert tone="warn">
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          {canSubmit && (
            <Button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await submitAction(docId);
                  if (!r.ok) return setError(r.error.message);
                  if (r.data.warnings.length) setWarnings(r.data.warnings);
                  router.refresh();
                })
              }
            >
              Ajukan
            </Button>
          )}
          {canEdit && (
            <Link
              href={`/docs/${slug}/${docId}/edit`}
              className="inline-flex min-h-[44px] items-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {editLabel}
            </Link>
          )}
          {canCancelOpname && !cancelling && (
            <Button variant="ghost" className="text-red-700" onClick={() => setCancelling(true)}>
              Batalkan Opname
            </Button>
          )}
          {canDelete && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (!confirm("Hapus draft ini? Tindakan tidak bisa dibatalkan.")) return;
                run(async () => {
                  const r = await deleteDraftAction(docId);
                  if (!r.ok) return setError(r.error.message);
                  router.push(`/docs/${slug}`);
                });
              }}
            >
              Hapus Draft
            </Button>
          )}
          {canReverse && !reversing && (
            <Button variant="secondary" onClick={() => setReversing(true)}>
              Buat Transaksi Pembalik
            </Button>
          )}
        </div>

        {cancelling && (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Sesi dibatalkan dan penempatan dibuka kembali untuk transaksi lain. Stok tidak berubah.
            </p>
            <Field label="Alasan pembatalan" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Button
                variant="danger"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  run(async () => {
                    const r = await cancelOpnameAction(docId, reason);
                    if (!r.ok) return setError(r.error.message);
                    setCancelling(false);
                    router.refresh();
                  })
                }
              >
                Batalkan Sesi
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(false)}>Tidak jadi</Button>
            </div>
          </div>
        )}

        {reversing && (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Dokumen tervalidasi tidak bisa diedit. Transaksi pembalik membalik efek stoknya dan melewati approval yang sama.
            </p>
            <Field label="Alasan koreksi" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Button
                disabled={pending || !reason.trim()}
                onClick={() =>
                  run(async () => {
                    const r = await reverseAction(docId, reason);
                    if (!r.ok) return setError(r.error.message);
                    router.push(`/docs/${slug}/${r.data.id}`);
                  })
                }
              >
                Buat Pembalik
              </Button>
              <Button variant="ghost" onClick={() => setReversing(false)}>Batal</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Panel keputusan approver / validator                                */
/* ------------------------------------------------------------------ */
export interface AllocLine {
  id: string;
  itemCode: string;
  itemName: string;
  qty: number;
  uom: string;
  stock: Array<{ location_id: string; label: string; qty: number }>;
}
type AllocRow = { location_id: string; qty: string };

export function DecisionPanel({
  docId,
  stepRole,
  needsAllocation,
  allocLines,
}: {
  docId: string;
  stepRole: "KEPALA_DEPT" | "KEPALA_GUDANG";
  needsAllocation: boolean;
  allocLines: AllocLine[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [alloc, setAlloc] = useState<Record<string, AllocRow[]>>(() =>
    Object.fromEntries(allocLines.map((l) => [l.id, [{ location_id: "", qty: "" }]])),
  );

  const approveLabel = stepRole === "KEPALA_GUDANG" ? "Validasi" : "Setujui";
  const allocatedOf = (lineId: string) =>
    (alloc[lineId] ?? []).reduce((s, r) => s + (Number(r.qty.replace(",", ".")) || 0), 0);

  function autoFill() {
    const next: Record<string, AllocRow[]> = {};
    for (const l of allocLines) {
      let remaining = l.qty;
      const rows: AllocRow[] = [];
      for (const s of [...l.stock].sort((a, b) => b.qty - a.qty)) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, s.qty);
        rows.push({ location_id: s.location_id, qty: String(take) });
        remaining -= take;
      }
      next[l.id] = rows.length ? rows : [{ location_id: "", qty: "" }];
    }
    setAlloc(next);
  }

  function decide(decision: "APPROVE" | "RETURN" | "REJECT") {
    setError(null);
    if (decision !== "APPROVE" && !reason.trim()) return setError("Alasan wajib diisi untuk mengembalikan atau menolak.");
    let allocations: Array<{ line_id: string; location_id: string; qty: string }> | null = null;
    if (decision === "APPROVE" && needsAllocation) {
      allocations = [];
      for (const l of allocLines) {
        for (const r of alloc[l.id] ?? []) {
          if (!r.location_id && !r.qty.trim()) continue;
          if (!r.location_id) return setError(`${l.itemCode}: pilih penempatan untuk setiap baris alokasi.`);
          allocations.push({ line_id: l.id, location_id: r.location_id, qty: r.qty });
        }
        if (Math.abs(allocatedOf(l.id) - l.qty) > 1e-9) {
          return setError(`${l.itemCode}: total alokasi (${fmtQty(allocatedOf(l.id))}) harus sama dengan jumlah diminta (${fmtQty(l.qty)}).`);
        }
      }
    }
    start(async () => {
      const r = await decideAction({ docId, decision, reason: reason || undefined, allocations });
      if (!r.ok) return setError(r.error.message);
      router.refresh();
    });
  }

  return (
    <Card title={stepRole === "KEPALA_GUDANG" ? "Validasi Dokumen" : "Persetujuan Dokumen"}>
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {needsAllocation && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-700">
                Tentukan penempatan sumber untuk tiap material. Stok berkurang dari penempatan ini saat Anda memvalidasi.
              </p>
              <Button type="button" variant="secondary" onClick={autoFill}>Isi otomatis</Button>
            </div>
            {allocLines.map((l) => {
              const total = allocatedOf(l.id);
              const ok = Math.abs(total - l.qty) < 1e-9;
              return (
                <div key={l.id} className="rounded-md border border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-900">{l.itemCode} — {l.itemName}</div>
                    <div className={ok ? "text-sm text-green-700" : "text-sm text-amber-700"}>
                      Dialokasikan {fmtQty(total)} dari {fmtQty(l.qty)} {l.uom}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {(alloc[l.id] ?? []).map((row, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <Select
                          className="min-w-64 flex-1"
                          value={row.location_id}
                          onChange={(e) =>
                            setAlloc((a) => ({
                              ...a,
                              [l.id]: a[l.id].map((r, j) => (j === i ? { ...r, location_id: e.target.value } : r)),
                            }))
                          }
                        >
                          <option value="">— Pilih penempatan —</option>
                          {l.stock.map((s) => (
                            <option key={s.location_id} value={s.location_id}>
                              {s.label} — tersedia {fmtQty(s.qty)}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className="w-32"
                          inputMode="decimal"
                          placeholder="Qty"
                          value={row.qty}
                          onChange={(e) =>
                            setAlloc((a) => ({
                              ...a,
                              [l.id]: a[l.id].map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)),
                            }))
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2"
                          aria-label="Hapus alokasi"
                          onClick={() =>
                            setAlloc((a) => ({
                              ...a,
                              [l.id]: a[l.id].length === 1 ? [{ location_id: "", qty: "" }] : a[l.id].filter((_, j) => j !== i),
                            }))
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 px-2 text-blue-700"
                    onClick={() => setAlloc((a) => ({ ...a, [l.id]: [...a[l.id], { location_id: "", qty: "" }] }))}
                  >
                    + Tambah penempatan
                  </Button>
                  {l.stock.length === 0 && (
                    <p className="mt-2 text-sm text-red-700">Tidak ada stok {l.itemCode} di gudang ini.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Field label="Alasan / catatan" hint="Wajib diisi bila mengembalikan atau menolak.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-3">
          <Button disabled={pending} onClick={() => decide("APPROVE")}>{approveLabel}</Button>
          <Button variant="warn" disabled={pending} onClick={() => decide("RETURN")}>Kembalikan untuk Revisi</Button>
          <Button variant="danger" disabled={pending} onClick={() => decide("REJECT")}>Tolak</Button>
        </div>
      </div>
    </Card>
  );
}
