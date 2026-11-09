import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { docHref, docTypeByType } from "@/lib/domain/doc-types";
import { first } from "@/lib/documents";
import { fmtDateTime, STATUS_LABEL, STATUS_TONE, STEP_LABEL } from "@/lib/format";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function ApprovalsPage() {
  await requireAnyPerm("doc.decide");
  const supabase = await createClient();
  const { data: inbox } = await supabase
    .from("v_inbox")
    .select("id, doc_type, doc_no, status, step_role, submitted_at")
    .order("submitted_at", { ascending: true });

  const ids = (inbox ?? []).map((r) => r.id);
  const { data: extra } = ids.length
    ? await supabase
        .from("document")
        .select("id, creator:app_user!created_by(full_name), warehouse:warehouse(code), reverses_document_id")
        .in("id", ids)
    : { data: [] };
  const info = new Map((extra ?? []).map((e) => [e.id, e]));

  return (
    <>
      <PageHeader title="Inbox Approval" subtitle="Dokumen yang menunggu keputusan Anda, diurutkan dari yang terlama." />
      <Card>
        {!inbox?.length ? (
          <Empty>Tidak ada dokumen yang menunggu keputusan Anda.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nomor</Th>
                <Th>Jenis</Th>
                <Th>Langkah Anda</Th>
                <Th>Gudang</Th>
                <Th>Dibuat oleh</Th>
                <Th>Diajukan</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inbox.map((r) => {
                const e = info.get(r.id);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={docHref(r.doc_type, r.id)} className="font-medium text-blue-700 hover:underline">
                        {r.doc_no}
                      </Link>
                      {e?.reverses_document_id && <span className="ml-2 text-xs text-slate-500">pembalik</span>}
                    </Td>
                    <Td>{docTypeByType(r.doc_type)?.label}</Td>
                    <Td>{STEP_LABEL[r.step_role]}</Td>
                    <Td>{first(e?.warehouse as unknown as { code: string } | null)?.code}</Td>
                    <Td>{first(e?.creator as unknown as { full_name: string } | null)?.full_name}</Td>
                    <Td>{fmtDateTime(r.submitted_at)}</Td>
                    <Td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
