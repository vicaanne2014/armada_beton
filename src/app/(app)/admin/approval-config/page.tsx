import { FlowToggle } from "@/components/flow-toggle";
import { Alert, Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { DOC_TYPES } from "@/lib/domain/doc-types";
import { STEP_LABEL } from "@/lib/format";
import { requireAnyPerm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function ApprovalConfigPage() {
  await requireAnyPerm("approval_config.manage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("approval_flow_config")
    .select("doc_type, step_order, step_role, is_active")
    .order("doc_type")
    .order("step_order");

  return (
    <>
      <PageHeader title="Alur Approval" subtitle="Langkah approval per jenis dokumen. Perubahan hanya berlaku untuk dokumen yang diajukan sesudahnya." />
      <Alert tone="info" className="mb-5">
        Validasi Kepala Gudang <b>selalu wajib</b> dan tidak bisa dimatikan, karena stok hanya boleh berubah saat divalidasi.
        Yang bisa diatur hanya langkah Approval Kepala Departemen.
      </Alert>
      <div className="grid gap-5 lg:grid-cols-2">
        {DOC_TYPES.map((d) => (
          <Card key={d.type} title={d.label}>
            <Table>
              <thead><tr><Th>Urutan</Th><Th>Langkah</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(data ?? [])
                  .filter((c) => c.doc_type === d.type)
                  .map((c) => (
                    <tr key={c.step_order}>
                      <Td>{c.step_order}</Td>
                      <Td>{STEP_LABEL[c.step_role]}</Td>
                      <Td>
                        {c.step_role === "KEPALA_GUDANG" ? (
                          <Badge tone="blue">Wajib</Badge>
                        ) : (
                          <FlowToggle docType={d.type} stepOrder={c.step_order} active={c.is_active} />
                        )}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}
