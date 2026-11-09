import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { ReportPdf } from "@/lib/pdf/report";
import { fetchReport, reportByKey, type ReportParams } from "@/lib/reports";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Export laporan ke Excel atau PDF. Hak akses: permission laporan + RLS data (tidak pernah lebih luas dari layar). */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const def = reportByKey(key);
  if (!def) return new Response("Not found", { status: 404 });
  if (!session.can(def.perm) && !session.can("report.read.all")) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const p: ReportParams = {};
  for (const k of ["warehouse", "q", "from", "to", "type", "status"] as const) {
    const v = url.searchParams.get(k);
    if (v) p[k] = v;
  }

  const supabase = await createClient();
  const rows = await fetchReport(supabase, def.key, p);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${def.key}-${stamp}.${format}`;

  if (format === "pdf") {
    const text = rows.map((r) =>
      def.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if (c.kind === "qty") return fmtQty(v);
        if (c.kind === "datetime" || c.kind === "date") return fmtDateTime(String(v));
        return String(v);
      }),
    );
    const buf = await renderToBuffer(
      createElement(ReportPdf, {
        title: def.title,
        subtitle: `Dicetak ${fmtDateTime(new Date().toISOString())} oleh ${session.fullName}`,
        columns: def.columns.map((c) => ({ label: c.label, numeric: c.kind === "qty" })),
        rows: text,
      }) as never,
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS Batching Plant";
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  ws.columns = def.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.kind === "datetime" ? 20 : c.kind === "qty" ? 14 : 22,
    style: c.kind === "qty" ? { numFmt: "#,##0.####" } : c.kind === "datetime" ? { numFmt: "dd-mmm-yyyy hh:mm" } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    ws.addRow(
      Object.fromEntries(
        def.columns.map((c) => {
          const v = r[c.key];
          return [c.key, (c.kind === "datetime" || c.kind === "date") && v ? new Date(String(v)) : v];
        }),
      ),
    );
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
