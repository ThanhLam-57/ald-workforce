"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ProtectedError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "protected_page.error",
        digest: error.digest ?? null,
        message: error.message,
      }),
    );
  }, [error]);

  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm sm:p-12">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">
        Không thể tải dữ liệu
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">Trang này đang gặp sự cố</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Dữ liệu chưa được thay đổi. Bạn có thể thử tải lại hoặc quay về trang tổng quan.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          onClick={reset}
          type="button"
        >
          Thử tải lại
        </button>
        <Link
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          href="/dashboard"
        >
          Về trang tổng quan
        </Link>
      </div>
    </section>
  );
}
