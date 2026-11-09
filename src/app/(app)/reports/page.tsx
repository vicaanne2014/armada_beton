import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { REPORTS } from "@/lib/reports";
import { requireSession } from "@/lib/session";

export default async function ReportsPage() {
  const s = await requireSession();
  const allowed = REPORTS.filter((r) => s.can(r.perm) || s.can("report.read.all"));
  if (!allowed.length) notFound();
  return (
    <>
      <PageHeader title="Laporan" subtitle="Data yang tampil mengikuti hak akses gudang dan peran Anda." />
      <div className="grid gap-4 md:grid-cols-3">
        {allowed.map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="block">
            <Card className="h-full transition-colors hover:border-blue-300">
              <h2 className="text-base font-semibold text-slate-900">{r.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{r.description}</p>
              <p className="mt-3 text-xs text-slate-500">Export: Excel, PDF</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
