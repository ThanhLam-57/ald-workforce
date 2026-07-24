import Link from "next/link";

import { listBranches, listStaff } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

const roleContent = {
  GENERAL_MANAGER: {
    eyebrow: "Trung tâm điều hành",
    title: "Tổng quan công ty",
    description: "Theo dõi tình hình vận hành và đi thẳng đến các nghiệp vụ cần xử lý trong ngày.",
  },
  TRAINING_MANAGER: {
    eyebrow: "Không gian quản lý",
    title: "Tổng quan cơ sở",
    description:
      "Theo dõi phạm vi được phân công và tiếp tục nhập chấm công hoặc kiểm tra bảng tháng.",
  },
  LIVE_EMPLOYEE: {
    eyebrow: "Không gian cá nhân",
    title: "Tổng quan của tôi",
    description: "Xem các thông tin đã được công bố và quản lý bảo mật tài khoản.",
  },
} as const;

export default async function DashboardPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"]);
  const content = roleContent[actor.role];
  const [branches, staff] =
    actor.role === "LIVE_EMPLOYEE"
      ? [[], []]
      : await Promise.all([listBranches(actor), listStaff(actor, new Date())]);

  return (
    <>
      <PageHeader {...content} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {actor.role !== "LIVE_EMPLOYEE" ? (
          <>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Cơ sở trong phạm vi</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">{branches.length}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Nhân sự trong phạm vi</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">{staff.length}</p>
            </article>
            <Link
              className="rounded-2xl border border-sky-200 bg-sky-50 p-5 transition hover:border-sky-300 hover:bg-sky-100"
              href="/attendance"
            >
              <p className="text-sm font-semibold text-sky-900">Nhập chấm công</p>
              <p className="mt-2 text-sm leading-6 text-sky-700">
                Mở hồ sơ Attendance & Live theo tháng
              </p>
            </Link>
            <Link
              className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:bg-slate-50"
              href="/branch-overview"
            >
              <p className="text-sm font-semibold text-slate-900">Kiểm tra bảng cơ sở</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Xem tổng doanh số, công và thời lượng Live
              </p>
            </Link>
          </>
        ) : (
          <>
            <Link
              className="rounded-2xl border border-sky-200 bg-sky-50 p-5 transition hover:bg-sky-100"
              href="/my-payslips"
            >
              <p className="text-sm font-semibold text-sky-900">Phiếu lương của tôi</p>
              <p className="mt-2 text-sm leading-6 text-sky-700">Xem phiếu lương đã được công bố</p>
            </Link>
            <Link
              className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:bg-slate-50"
              href="/settings/security"
            >
              <p className="text-sm font-semibold text-slate-900">Bảo mật tài khoản</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Cập nhật mật khẩu và kiểm tra thông tin đăng nhập
              </p>
            </Link>
          </>
        )}
      </div>
    </>
  );
}
