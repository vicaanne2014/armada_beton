"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { removeAttachmentAction } from "@/app/actions/opname";
import { Alert, Button, Card } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export interface AttachmentItem {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

const MAX = 5;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AttachmentsCard({
  docId,
  items,
  editable,
}: {
  docId: string;
  items: AttachmentItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > 5 * 1024 * 1024) return setError("Ukuran berkas maksimal 5 MB.");
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/documents/${docId}/attachments`, { method: "POST", body });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        return setError(j?.message ?? "Gagal mengunggah berkas.");
      }
      router.refresh();
    } catch {
      setError("Koneksi bermasalah. Coba unggah ulang.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card title={`Lampiran Surat Jalan Masuk (${items.length}/${MAX})`}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!items.length ? (
          <p className="text-sm text-slate-500">Belum ada lampiran.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <a
                    href={`/api/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium text-blue-700 hover:underline"
                  >
                    {a.file_name}
                  </a>
                  <span className="text-xs text-slate-500">
                    {a.content_type === "application/pdf" ? "PDF" : "Foto"} · {kb(a.size_bytes)} · {fmtDateTime(a.uploaded_at)}
                  </span>
                </div>
                {editable && (
                  <Button
                    variant="ghost"
                    className="px-3 text-red-700"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Hapus lampiran "${a.file_name}"?`)) return;
                      start(async () => {
                        setError(null);
                        const r = await removeAttachmentAction(a.id);
                        if (!r.ok) return setError(r.error.message);
                        router.refresh();
                      });
                    }}
                  >
                    Hapus
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable ? (
          items.length >= MAX ? (
            <p className="text-sm text-slate-500">Batas {MAX} lampiran tercapai.</p>
          ) : (
            <div>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <Button type="button" variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
                {uploading ? "Mengunggah..." : "+ Foto / PDF Surat Jalan"}
              </Button>
              <p className="mt-2 text-xs text-slate-500">JPG, PNG, WEBP, atau PDF, maksimal 5 MB. Di tablet, kamera bisa dipilih langsung.</p>
            </div>
          )
        ) : (
          <p className="text-xs text-slate-400">Lampiran terkunci setelah dokumen diajukan.</p>
        )}
      </div>
    </Card>
  );
}
