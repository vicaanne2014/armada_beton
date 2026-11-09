import "server-only";
import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface Session {
  userId: string;
  username: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  departmentId: string | null;
  perms: Set<string>;
  can: (code: string) => boolean;
}

/** Sesi user saat ini. Memakai getUser() (diverifikasi ke Auth server), bukan cookie mentah. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_user")
    .select("id, username, full_name, is_active, department_id, role_id, role:app_role(code, name)")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  const { data: perms } = await supabase
    .from("role_permission")
    .select("permission:permission(code)")
    .eq("role_id", profile.role_id);

  const set = new Set<string>(
    (perms ?? []).map((p) => (p.permission as unknown as { code: string } | null)?.code ?? "").filter(Boolean),
  );
  const role = profile.role as unknown as { code: string; name: string } | null;
  return {
    userId: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    roleCode: role?.code ?? "",
    roleName: role?.name ?? "",
    departmentId: profile.department_id,
    perms: set,
    can: (code: string) => set.has(code),
  };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Halaman yang butuh salah satu permission; selain itu 404 (tidak membocorkan keberadaan halaman). */
export async function requireAnyPerm(...codes: string[]): Promise<Session> {
  const s = await requireSession();
  if (!codes.some((c) => s.can(c))) notFound();
  return s;
}
