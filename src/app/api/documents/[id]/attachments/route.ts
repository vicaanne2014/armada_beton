import { randomUUID } from "node:crypto";
import { mapDbError } from "@/lib/domain/errors";
import { sniffFile } from "@/lib/file-sniff";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Unggah lampiran (foto surat jalan masuk). Hak akses diputuskan RPC add_attachment (pembuat, draft/dikembalikan). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return json({ message: "Sesi berakhir. Silakan login kembali." }, 401);
  if (!UUID.test(id)) return json({ message: "ID dokumen tidak valid." }, 400);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return json({ message: "Permintaan tidak valid." }, 400);
  }
  if (!file || file.size === 0) return json({ message: "Pilih berkas yang akan diunggah." }, 400);
  if (file.size > MAX_BYTES) return json({ message: "Ukuran berkas maksimal 5 MB." }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFile(bytes);
  if (!kind) return json({ message: "Format berkas tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF." }, 415);

  const supabase = await createClient();
  const path = `${id}/${randomUUID()}.${kind.ext}`;
  const admin = createAdminClient();

  const up = await admin.storage.from("attachments").upload(path, bytes, { contentType: kind.type, upsert: false });
  if (up.error) return json({ message: "Gagal menyimpan berkas. Coba lagi." }, 502);

  const { data, error } = await supabase.rpc("add_attachment", {
    p_doc_id: id,
    p_path: path,
    p_file_name: file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200),
    p_content_type: kind.type,
    p_size: file.size,
  });
  if (error) {
    await admin.storage.from("attachments").remove([path]); // jangan tinggalkan berkas tanpa baris
    return json({ message: mapDbError(error).message }, 422);
  }
  return json({ id: data });
}
