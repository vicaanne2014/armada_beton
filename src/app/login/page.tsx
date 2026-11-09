import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">WMS Batching Plant</h1>
        <p className="mt-1 text-sm text-slate-600">Masuk untuk mengelola stok material dan barang jadi.</p>
        <LoginForm />
      </div>
    </main>
  );
}
