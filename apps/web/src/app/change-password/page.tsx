import { redirect } from "next/navigation";

import { getOptionalActor } from "@/server/auth-context";

import { ChangePasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
          ALD Workforce
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Đổi mật khẩu</h1>
        <p className="mt-2 text-sm text-slate-600">
          Mật khẩu phải dài ít nhất 12 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt. Các
          phiên đăng nhập khác sẽ bị thu hồi.
        </p>
        <ChangePasswordForm required={Boolean(actor.mustChangePassword)} />
      </section>
    </main>
  );
}
