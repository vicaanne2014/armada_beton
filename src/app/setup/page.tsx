export default function SetupPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Konfigurasi Supabase belum diatur</h1>
      <p className="mt-3 text-slate-600">
        Salin <code className="rounded bg-slate-100 px-1">.env.example</code> menjadi{" "}
        <code className="rounded bg-slate-100 px-1">.env.local</code>, isi URL dan kunci project Supabase Anda, lalu
        jalankan ulang <code className="rounded bg-slate-100 px-1">npm run dev</code>.
      </p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-slate-700">
        <li>
          Terapkan migrasi di <code className="rounded bg-slate-100 px-1">supabase/migrations</code> ke project Anda
          (<code className="rounded bg-slate-100 px-1">supabase db push</code> atau SQL Editor, berurutan).
        </li>
        <li>
          Isi data awal dan user demo: <code className="rounded bg-slate-100 px-1">npm run seed</code>.
        </li>
        <li>Login dengan user <code className="rounded bg-slate-100 px-1">admin</code>.</li>
      </ol>
      <p className="mt-6 text-sm text-slate-500">Lihat README.md untuk langkah lengkap.</p>
    </main>
  );
}
