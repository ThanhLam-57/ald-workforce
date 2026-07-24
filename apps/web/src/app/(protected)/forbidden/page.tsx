import Link from "next/link";

import { BackButton } from "./back-button";

export default function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-8 shadow-sm sm:p-12">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
        Quyền truy cập
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">
        Bạn không có quyền mở trang này
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Hệ thống đã kiểm tra vai trò và phạm vi từ phiên đăng nhập. Nếu bạn cho rằng đây là nhầm
        lẫn, hãy liên hệ Tổng quản lý để kiểm tra phân công.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          href="/dashboard"
        >
          Về trang tổng quan
        </Link>
        <BackButton />
      </div>
    </section>
  );
}
