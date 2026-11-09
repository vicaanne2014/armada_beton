import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/documents";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import { docHref } from "@/lib/domain/doc-types";
import { first } from "@/lib/documents";
import { fmtDateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const s = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification")
    .select("id, kind, message, created_at, read_at, document:document(id, doc_type)")
    .eq("user_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  async function markAll() {
    "use server";
    await markNotificationsReadAction();
  }

  return (
    <>
      <PageHeader
        title="Notifikasi"
        subtitle={`${unread} belum dibaca`}
        actions={
          unread > 0 ? (
            <form action={markAll}>
              <Button type="submit" variant="secondary">Tandai semua dibaca</Button>
            </form>
          ) : undefined
        }
      />
      <Card>
        {!data?.length ? (
          <Empty>Belum ada notifikasi.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((n) => {
              const doc = first(n.document as unknown as { id: string; doc_type: string } | null);
              return (
                <li key={n.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-slate-300" : "bg-blue-600"}`} />
                    <div>
                      {doc ? (
                        <Link href={docHref(doc.doc_type, doc.id)} className="text-sm font-medium text-slate-900 hover:underline">
                          {n.message}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium text-slate-900">{n.message}</span>
                      )}
                      <div className="text-xs text-slate-500">{fmtDateTime(n.created_at)}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
