import { Suspense } from "react";
import { WIDGET_COMPONENTS } from "@/components/dashboard-widgets";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { DEFAULT_BY_ROLE, parseDashboardConfig } from "@/lib/widgets";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const s = await requireSession();
  const supabase = await createClient();
  const { data: cfg } = await supabase.from("dashboard_config").select("widgets").eq("user_id", s.userId).maybeSingle();
  const { keys, warehouseId } = parseDashboardConfig(cfg?.widgets);
  const active = (keys ?? DEFAULT_BY_ROLE[s.roleCode] ?? []).filter((k) => k in WIDGET_COMPONENTS);

  return (
    <>
      <PageHeader
        title={`Halo, ${s.fullName}`}
        subtitle={s.roleName}
        actions={<LinkButton href="/dashboard/settings" variant="secondary">Atur Dashboard</LinkButton>}
      />
      {!active.length ? (
        <Card>
          <p className="text-sm text-slate-600">Belum ada widget yang dipilih. Gunakan “Atur Dashboard”.</p>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {active.map((k) => {
            const W = WIDGET_COMPONENTS[k];
            return (
              <Suspense key={k} fallback={<Card><div className="h-24 animate-pulse rounded bg-slate-100" /></Card>}>
                <W supabase={supabase} userId={s.userId} warehouseId={warehouseId} />
              </Suspense>
            );
          })}
        </div>
      )}
    </>
  );
}
