import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocumentFull, first } from "@/lib/documents";
import { fmtDate, fmtQty } from "@/lib/format";
import { DeliveryNotePdf, type DeliveryNotePdfData } from "@/lib/pdf/delivery-note";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Surat jalan keluar (PDF). Dirender sesuai permintaan dari data tervalidasi yang tidak bisa
 * berubah, dan hanya untuk user yang boleh melihat dokumennya (RLS).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const supabase = await createClient();
  const full = await getDocumentFull(supabase, id);
  if (!full) return new Response("Not found", { status: 404 });
  const { doc, ext, steps, liveReversal } = full;
  if (doc.doc_type !== "DELIVERY_NOTE" || doc.status !== "TERVALIDASI" || doc.reverses_document_id || !ext?.sj_number) {
    return new Response("Surat jalan hanya tersedia untuk pengiriman yang sudah divalidasi.", { status: 409 });
  }

  const { data: customer } = await supabase
    .from("party")
    .select("name, address")
    .eq("id", ext.customer_id)
    .maybeSingle();

  const approved = steps.filter((st: { decision: string; cycle: number }) => st.decision === "APPROVED" && st.cycle === doc.cycle);
  const by = (role: string) =>
    (first(approved.find((st: { step_role: string }) => st.step_role === role)?.approver) as { full_name: string } | null)?.full_name ?? "-";
  const warehouse = first(doc.warehouse) as { name: string };

  const data: DeliveryNotePdfData = {
    sjNumber: ext.sj_number,
    deliveryDate: fmtDate(ext.delivery_date),
    customerName: customer?.name ?? "-",
    customerAddress: customer?.address ?? null,
    customerPoRef: ext.customer_po_ref ?? null,
    warehouseName: warehouse?.name ?? "-",
    docNo: doc.doc_no,
    voided: liveReversal?.status === "TERVALIDASI",
    createdBy: (first(doc.creator) as { full_name: string } | null)?.full_name ?? "-",
    approvedBy: by("KEPALA_DEPT"),
    validatedBy: by("KEPALA_GUDANG"),
    lines: doc.lines.map((l: Record<string, unknown>, i: number) => {
      const item = l.item as { code: string; name: string; uom: { code: string } | { code: string }[] | null };
      return {
        no: i + 1,
        code: item.code,
        name: item.name,
        qty: fmtQty(l.qty as number),
        uom: first(item.uom)?.code ?? "",
        location: (first(l.loc as { code: string } | null))?.code ?? "",
      };
    }),
  };

  const buffer = await renderToBuffer(createElement(DeliveryNotePdf, { d: data }) as never);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ext.sj_number.replaceAll("/", "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
