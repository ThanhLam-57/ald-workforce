import { TwoFactorForm } from "./two-factor-form";

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
          ALD Workforce
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Xác thực hai lớp</h1>
        <p className="mt-2 text-sm text-slate-600">
          Nhập mã từ ứng dụng xác thực hoặc dùng một mã dự phòng.
        </p>
        <TwoFactorForm />
      </section>
    </main>
  );
}
