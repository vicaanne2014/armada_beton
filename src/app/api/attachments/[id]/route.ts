import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unduh lampiran. Hak akses = bisa melihat dokumennya (RLS pada document_attachment);
 * berkas bucket privat dilayani lewat signed URL berumur pendek.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: att } = await supabase
    .from("document_attachment")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!att) return new Response("Not found", { status: 404 });

  const { data, error } = await createAdminClient().storage.from("attachments").createSignedUrl(att.storage_path, 60);
  if (error || !data?.signedUrl) return new Response("Berkas tidak tersedia", { status: 502 });
  return NextResponse.redirect(data.signedUrl, 302);
}
