"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const LoginSchema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi").max(64),
  password: z.string().min(1, "Password wajib diisi").max(200),
});

export interface LoginState {
  error?: string;
}

/** Login memakai username; Supabase Auth memakai email sintetis <username>@wms.local. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: `${parsed.data.username.toLowerCase()}@wms.local`,
    password: parsed.data.password,
  });
  // Pesan sengaja generik agar tidak membuka enumerasi user
  if (error) return { error: "Username atau password salah." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("app_user").select("is_active").eq("id", user.id).maybeSingle()
    : { data: null };
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Akun tidak aktif. Hubungi Admin." };
  }
  redirect("/");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
