import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui";
import { DOC_TYPES, type DocTypeDef } from "@/lib/domain/doc-types";
import { requireSession, type Session } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

function visibleDocTypes(s: Session): DocTypeDef[] {
  if (s.can("doc.decide") || s.can("report.read.all")) return DOC_TYPES;
  return DOC_TYPES.filter((d) => {
    if (s.can(d.createPerm)) return true;
    if (s.roleCode === "STAFF_GUDANG_MATERIAL") return d.group === "material";
    if (s.roleCode === "STAFF_GUDANG_BJ") return d.group === "finished";
    return false;
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const supabase = await createClient();
  const [{ count: unread }, { count: inbox }] = await Promise.all([
    supabase.from("notification").select("id", { count: "exact", head: true }).eq("user_id", s.userId).is("read_at", null),
    s.can("doc.decide")
      ? supabase.from("v_inbox").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: 0 }),
  ]);

  const docs = visibleDocTypes(s);
  const material = docs.filter((d) => d.group === "material");
  const finished = docs.filter((d) => d.group === "finished");
  const shared = docs.filter((d) => d.group === "shared");
  const canStock = s.can("report.stock") || s.can("stock.read.all") || s.can("report.read.all");
  const canReports = s.can("report.stock") || s.can("report.movement") || s.can("report.documents");
  const isAdminish = s.can("master.manage") || s.can("user.manage") || s.can("approval_config.manage") || s.can("audit.read");

  const nav = (
    <nav className="p-3">
      <Section title="Umum">
        <NavLink href="/" exact>Dashboard</NavLink>
        {s.can("doc.decide") && (
          <NavLink href="/approvals">
            Inbox Approval
            {!!inbox && <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] text-white">{inbox}</span>}
          </NavLink>
        )}
        <NavLink href="/notifications">
          Notifikasi
          {!!unread && <span className="ml-2 rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] text-white">{unread}</span>}
        </NavLink>
      </Section>
      {material.length > 0 && (
        <Section title="Gudang Material">
          {material.map((d) => (
            <NavLink key={d.slug} href={`/docs/${d.slug}`}>{d.menu}</NavLink>
          ))}
        </Section>
      )}
      {finished.length > 0 && (
        <Section title="Gudang Barang Jadi">
          {finished.map((d) => (
            <NavLink key={d.slug} href={`/docs/${d.slug}`}>{d.menu}</NavLink>
          ))}
        </Section>
      )}
      {shared.length > 0 && (
        <Section title="Antar Penempatan">
          {shared.map((d) => (
            <NavLink key={d.slug} href={`/docs/${d.slug}`}>{d.menu}</NavLink>
          ))}
        </Section>
      )}
      <Section title="Monitoring">
        {canStock && <NavLink href="/stock">Stok &amp; Kartu Stok</NavLink>}
        <NavLink href="/po">PO Produksi</NavLink>
        {canReports && <NavLink href="/reports">Laporan</NavLink>}
      </Section>
      {isAdminish && (
        <Section title="Administrasi">
          {s.can("master.manage") && <NavLink href="/master/warehouses">Master Data</NavLink>}
          {(s.can("master.manage") || s.can("location.manage")) && <NavLink href="/master/locations">Penempatan</NavLink>}
          {s.can("user.manage") && <NavLink href="/master/users">Pengguna</NavLink>}
          {s.can("approval_config.manage") && <NavLink href="/admin/approval-config">Alur Approval</NavLink>}
          {s.can("audit.read") && <NavLink href="/audit">Audit Trail</NavLink>}
        </Section>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/" className="text-lg font-semibold text-slate-900">WMS Batching Plant</Link>
        </div>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">Menu</summary>
            <div className="absolute left-0 top-full z-20 mt-2 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {nav}
            </div>
          </details>
          <div className="hidden md:block" />
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-900">{s.fullName}</div>
              <div className="text-xs text-slate-500">{s.roleName}</div>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" className="min-h-[40px] px-3 py-2">Keluar</Button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
