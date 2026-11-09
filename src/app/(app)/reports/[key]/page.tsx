import { notFound } from "next/navigation";
import { Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { DOC_TYPES } from "@/lib/domain/doc-types";
import { fmtDateTime, fmtQty, STATUS_LABEL } from "@/lib/format";
import { fetchReport, reportByKey, type ReportParams } from "@/lib/reports";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const SHOWN = 500;

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<ReportParams>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const def = reportByKey(key);
  const s = await requireSession();
  if (!def || !(s.can(def.perm) || s.can("report.read.all"))) notFound();

  const supabase = await createClient();
  const [{ data: warehouses }, rows] = await Promise.all([
    supabase.from("warehouse").select("id, code, name").order("code"),
    fetchReport(supabase, def.key, sp, SHOWN + 1),
  ]);
  const truncated = rows.length > SHOWN;
  const shown = rows.slice(0, SHOWN);

  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const exportHref = (f: string) => `/api/export/${def.key}?${qs}${qs ? "&" : ""}format=${f}`;
  const has = (k: string) => def.key === "documents" || (k !== "type" && k !== "status");

  const cell = (kind: string, v: string | number | null) =>
    v === null || v === undefined ? "" : kind === "qty" ? fmtQty(v) : kind === "datetime" || kind === "date" ? fmtDateTime(String(v)) : String(v);

  return (
    <>
      <PageHeader
        title={def.title}
        subtitle={def.description}
        actions={
          <>
            <LinkButton href={exportHref("xlsx")} variant="secondary">Export Excel</LinkButton>
            <LinkButton href={exportHref("pdf")} variant="secondary">Export PDF</LinkButton>
          </>
        }
      />
      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <Field label="Gudang" className="w-52">
          <Select name="warehouse" defaultValue={sp.warehouse ?? ""}>
            <option value="">Semua</option>
            {(warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </Select>
        </Field>
        {def.key !== "documents" && (
          <Field label="Cari item" className="w-48"><Input name="q" defaultValue={sp.q ?? ""} placeholder="kode / nama" /></Field>
        )}
        {def.key !== "stock" && (
          <>
            <Field label="Dari" className="w-44"><Input type="date" name="from" defaultValue={sp.from ?? ""} /></Field>
            <Field label="Sampai" className="w-44"><Input type="date" name="to" defaultValue={sp.to ?? ""} /></Field>
          </>
        )}
        {has("type") && def.key === "documents" && (
          <>
            <Field label="Jenis" className="w-52">
              <Select name="type" defaultValue={sp.type ?? ""}>
                <option value="">Semua</option>
                {DOC_TYPES.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
              </Select>
            </Field>
            <Field label="Status" className="w-48">
              <Select name="status" defaultValue={sp.status ?? ""}>
                <option value="">Semua</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </>
        )}
        <Button type="submit" variant="secondary">Terapkan</Button>
      </form>

      <Card>
        {!shown.length ? (
          <Empty>Tidak ada data untuk filter ini.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {def.columns.map((c) => (
                    <Th key={c.key} className={c.kind === "qty" ? "text-right" : ""}>{c.label}</Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r, i) => (
                  <tr key={i}>
                    {def.columns.map((c) => (
                      <Td key={c.key} className={c.kind === "qty" ? "text-right tabular-nums" : ""}>{cell(c.kind, r[c.key])}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            {truncated && (
              <p className="mt-3 text-xs text-slate-500">
                Menampilkan {SHOWN} baris pertama. Persempit filter atau gunakan Export untuk data lengkap.
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
