"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cancelOpnameAction, saveOpnameCountAction } from "@/app/actions/opname";
import { Alert, Button, Card, Field, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { fmtQty } from "@/lib/format";

export interface CountLine {
  id: string;
  itemId: string;
  itemLabel: string;
  uom: string;
  locationId: string;
  locationLabel: string;
  system: number;
  counted: string;
  note: string;
}
interface NewLine {
  key: number;
  item_id: string;
  location_id: string;
  counted: string;
}

const num = (s: string) => Number(s.replace(",", "."));
const isBlank = (s: string) => s.trim() === "";

export function OpnameCountForm({
  docId,
  lines: initialLines,
  scope,
  items,
  note: initialNote,
  returnReason,
}: {
  docId: string;
  lines: CountLine[];
  scope: Array<{ id: string; label: string }>;
  items: Array<{ id: string; code: string; name: string; uom: string }>;
  note: string;
  returnReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState(initialLines);
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<NewLine[]>([]);
  const [note, setNote] = useState(initialNote);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const uncounted = lines.filter((l) => isBlank(l.counted)).length + added.filter((a) => isBlank(a.counted)).length;
  const diffs = lines.filter((l) => !isBlank(l.counted) && num(l.counted) !== l.system).length;

  const setLine = (id: string, patch: Partial<CountLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  function payload(submit: boolean) {
    return {
      docId,
      note,
      submit,
      lines: [
        ...lines.map((l) => ({ line_id: l.id, counted: l.counted, note: l.note })),
        ...removed.map((id) => ({ line_id: id, remove: true })),
        ...added
          .filter((a) => a.item_id && a.location_id)
          .map((a) => ({ item_id: a.item_id, location_id: a.location_id, counted: a.counted })),
      ],
    };
  }

  function save(submit: boolean) {
    setMsg(null);
    if (added.some((a) => !a.item_id || !a.location_id)) {
      return setMsg({ tone: "error", text: "Lengkapi item dan penempatan pada baris temuan baru, atau hapus barisnya." });
    }
    start(async () => {
      const r = await saveOpnameCountAction(payload(submit));
      if (!r.ok) return setMsg({ tone: "error", text: r.error.message });
      if (submit) return router.push(`/docs/stock-opnames/${docId}`);
      setRemoved([]);
      setAdded([]);
      setMsg({ tone: "success", text: "Hitungan tersimpan." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {returnReason && (
        <Alert tone="warn"><span className="font-medium">Dikembalikan:</span> {returnReason}</Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card
        title="Hitungan Fisik"
        action={
          <span className="text-sm text-slate-600">
            {uncounted > 0 ? <span className="text-amber-700">{uncounted} baris belum dihitung</span> : <span className="text-green-700">Semua baris terisi</span>}
            {" · "}{diffs} selisih
          </span>
        }
      >
        {!lines.length && !added.length ? (
          <p className="text-sm text-slate-500">
            Tidak ada stok sistem di penempatan ini. Tambahkan item yang ditemukan secara fisik dengan tombol di bawah.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Penempatan</Th>
                <Th>Item</Th>
                <Th className="text-right">Stok sistem</Th>
                <Th>Hitungan fisik</Th>
                <Th className="text-right">Selisih</Th>
                <Th>Catatan</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => {
                const blank = isBlank(l.counted);
                const diff = blank ? null : num(l.counted) - l.system;
                return (
                  <tr key={l.id} className={blank ? "bg-amber-50/50" : ""}>
                    <Td className="min-w-40">{l.locationLabel}</Td>
                    <Td className="min-w-48">
                      {l.itemLabel}
                      {l.system === 0 && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">temuan</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtQty(l.system)} {l.uom}</Td>
                    <Td className="w-40">
                      <Input
                        value={l.counted}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Hitungan ${l.itemLabel}`}
                        onChange={(e) => setLine(l.id, { counted: e.target.value })}
                      />
                    </Td>
                    <Td className={`text-right tabular-nums ${diff === null ? "" : diff < 0 ? "text-red-700" : diff > 0 ? "text-green-700" : "text-slate-500"}`}>
                      {diff === null || Number.isNaN(diff) ? "-" : `${diff > 0 ? "+" : ""}${fmtQty(diff)}`}
                    </Td>
                    <Td className="min-w-40">
                      <Input value={l.note} onChange={(e) => setLine(l.id, { note: e.target.value })} />
                    </Td>
                    <Td className="w-12">
                      {l.system === 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2"
                          aria-label="Hapus baris temuan"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.id !== l.id));
                            setRemoved((r) => [...r, l.id]);
                          }}
                        >
                          ✕
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {added.map((a) => {
                const it = itemById.get(a.item_id);
                return (
                  <tr key={a.key} className="bg-blue-50/50">
                    <Td className="min-w-40">
                      <Select value={a.location_id} onChange={(e) => setAdded((x) => x.map((r) => (r.key === a.key ? { ...r, location_id: e.target.value } : r)))}>
                        <option value="">— Penempatan —</option>
                        {scope.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Td>
                    <Td className="min-w-48">
                      <Select value={a.item_id} onChange={(e) => setAdded((x) => x.map((r) => (r.key === a.key ? { ...r, item_id: e.target.value } : r)))}>
                        <option value="">— Item —</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                      </Select>
                    </Td>
                    <Td className="text-right text-slate-400">baru</Td>
                    <Td className="w-40">
                      <div className="flex items-center gap-2">
                        <Input value={a.counted} inputMode="decimal" placeholder="0" onChange={(e) => setAdded((x) => x.map((r) => (r.key === a.key ? { ...r, counted: e.target.value } : r)))} />
                        <span className="text-xs text-slate-500">{it?.uom}</span>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums text-green-700">{isBlank(a.counted) || Number.isNaN(num(a.counted)) ? "-" : `+${fmtQty(num(a.counted))}`}</Td>
                    <Td />
                    <Td className="w-12">
                      <Button type="button" variant="ghost" className="px-2" aria-label="Hapus baris" onClick={() => setAdded((x) => x.filter((r) => r.key !== a.key))}>✕</Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAdded((x) => [...x, { key: Date.now() + x.length, item_id: "", location_id: scope.length === 1 ? scope[0].id : "", counted: "" }])}
          >
            + Item temuan yang belum ada di sistem
          </Button>
          <p className="mt-2 text-xs text-slate-500">
            Hitungan 0 adalah isian yang sah (barang tidak ditemukan). Selisih baru diposting ke stok setelah disetujui dan divalidasi Kepala Gudang.
          </p>
        </div>
      </Card>

      <Card title="Catatan">
        <Field label="Catatan sesi"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => save(false)}>
          {pending ? "Menyimpan..." : "Simpan Hitungan"}
        </Button>
        <Button type="button" disabled={pending || uncounted > 0} onClick={() => save(true)} title={uncounted > 0 ? "Semua baris harus dihitung" : undefined}>
          Simpan &amp; Ajukan
        </Button>
        <Button type="button" variant="ghost" className="text-red-700" onClick={() => setCancelling(true)}>
          Batalkan Opname
        </Button>
        <Link href={`/docs/stock-opnames/${docId}`} className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-600 hover:underline">
          Kembali
        </Link>
      </div>

      {cancelling && (
        <Card title="Batalkan sesi opname">
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Penempatan akan dibuka kembali untuk transaksi lain. Hitungan yang sudah diisi tidak dipakai.</p>
            <Field label="Alasan" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex gap-3">
              <Button
                variant="danger"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await cancelOpnameAction(docId, reason);
                    if (!r.ok) return setMsg({ tone: "error", text: r.error.message });
                    router.push(`/docs/stock-opnames/${docId}`);
                  })
                }
              >
                Batalkan Sesi
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(false)}>Tidak jadi</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
