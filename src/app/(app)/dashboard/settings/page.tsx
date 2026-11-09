import Link from "next/link";
import { DashboardSettings } from "@/components/dashboard-settings";
import { Field, PageHeader, Select, Button } from "@/components/ui";
import { DEFAULT_BY_ROLE, parseDashboardConfig, WIDGETS } from "@/lib/widgets";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardSettingsPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();

  // Admin boleh mengatur dashboard user lain (FR-20)
  const canManageAll = s.can("dashboard.manage_all");
  const targetId = canManageAll && sp.user ? sp.user : s.userId;

  const [{ data: cfg }, { data: warehouses }, { data: target }, users] = await Promise.all([
    supabase.from("dashboard_config").select("widgets").eq("user_id", targetId).maybeSingle(),
    supabase.from("warehouse").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("app_user").select("full_name, role:app_role(code)").eq("id", targetId).maybeSingle(),
    canManageAll ? supabase.from("app_user").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const parsed = parseDashboardConfig(cfg?.widgets);
  const roleCode = (Array.isArray(target?.role) ? target?.role[0] : (target?.role as unknown as { code: string } | null))?.code ?? s.roleCode;
  const selected = parsed.keys ?? DEFAULT_BY_ROLE[roleCode] ?? [];

  return (
    <>
      <PageHeader
        title="Atur Dashboard"
        subtitle={targetId === s.userId ? "Pilih widget dan filter untuk dashboard Anda." : `Dashboard milik ${target?.full_name}`}
        actions={<Link href="/" className="text-sm text-blue-700 hover:underline">← Kembali ke dashboard</Link>}
      />
      {canManageAll && (
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <Field label="Atur untuk pengguna" className="w-72">
            <Select name="user" defaultValue={targetId}>
              {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">Pilih</Button>
        </form>
      )}
      <DashboardSettings
        key={targetId}
        userId={targetId}
        widgets={WIDGETS}
        selected={selected}
        warehouses={warehouses ?? []}
        warehouseId={parsed.warehouseId ?? ""}
      />
    </>
  );
}
