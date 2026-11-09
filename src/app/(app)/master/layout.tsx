import { NavLink } from "@/components/nav-link";
import { MASTER_LIST } from "@/lib/master-config";
import { requireSession } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const canMaster = s.can("master.manage");
  const canLoc = canMaster || s.can("location.manage");
  if (!canMaster && !canLoc && !s.can("user.manage")) notFound();

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-3">
        {canMaster && MASTER_LIST.map((m) => (
          <div key={m.key}><NavLink href={`/master/${m.key}`}>{m.title}</NavLink></div>
        ))}
        {canLoc && <div><NavLink href="/master/locations">Penempatan</NavLink></div>}
        {s.can("user.manage") && <div><NavLink href="/master/users">Pengguna</NavLink></div>}
      </div>
      {children}
    </div>
  );
}
