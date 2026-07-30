import { redirect } from "next/navigation";

import { getOptionalActor } from "@/server/auth-context";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const actor = await getOptionalActor();
  if (actor) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
            ALD Workforce
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Đăng nhập hệ thống</h1>
          <p className="mt-2 text-sm text-slate-600">
            Tài khoản do Tổng quản lý cấp. Hệ thống không hỗ trợ tự đăng ký.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
