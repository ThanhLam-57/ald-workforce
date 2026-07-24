import type {
  BranchMonthlyOverviewDto,
  CompanyDashboardDto,
  PayrollPeriodDto,
} from "@ald/contracts";
import { DomainError, toBusinessDateString } from "@ald/domain";
import Link from "next/link";

import { getBranchMonthlyOverview } from "@/server/branch-overview-service";
import { getCompanyDashboard } from "@/server/company-dashboard-service";
import { listPayrollPeriods } from "@/server/payroll-service";
import { listBranches, listStaff } from "@/server/services";

import { PageHeader } from "../page-header";
import { requirePageActor } from "../page-access";

function money(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

function decimal(value: string): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value));
}

function minutes(value: number): string {
  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours} giờ ${remaining} phút` : `${remaining} phút`;
}

function SummaryCard({
  label,
  value,
  tone = "default",
  hint,
}: Readonly<{
  label: string;
  value: string;
  tone?: "default" | "danger" | "success";
  hint?: string;
}>) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-white";
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p> : null}
    </article>
  );
}

function ActionLink({
  href,
  label,
  description,
}: Readonly<{ href: string; label: string; description: string }>) {
  return (
    <Link
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
      href={href}
    >
      <p className="font-semibold text-slate-950 group-hover:text-sky-800">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      <span className="mt-4 inline-block text-sm font-semibold text-sky-700">Mở chức năng →</span>
    </Link>
  );
}

async function GeneralManagerDashboard({
  dashboard,
}: Readonly<{ dashboard: CompanyDashboardDto }>) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryCard label="Doanh số tháng" value={money(dashboard.totals.revenueAmount)} />
        <SummaryCard label="Tổng công" value={decimal(dashboard.totals.workUnits)} />
        <SummaryCard
          label="Tiền phạt"
          tone={BigInt(dashboard.totals.penalties) > 0n ? "danger" : "default"}
          value={money(dashboard.totals.penalties)}
        />
        <SummaryCard label="Tổng payroll" value={money(dashboard.totals.payrollTotal)} />
        <SummaryCard
          hint="Số ngày/nhân viên chưa có attendance đến hiện tại"
          label="Thiếu chấm công"
          tone={dashboard.totals.missingAttendance > 0 ? "danger" : "success"}
          value={String(dashboard.totals.missingAttendance)}
        />
        <SummaryCard
          label="Payroll chưa review"
          tone={dashboard.totals.unreviewedPayroll > 0 ? "danger" : "success"}
          value={String(dashboard.totals.unreviewedPayroll)}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-950">Tình hình theo cơ sở</h2>
              <p className="mt-1 text-sm text-slate-500">Tháng {dashboard.month}</p>
            </div>
            <Link className="text-sm font-semibold text-sky-700" href="/company-report">
              Xem báo cáo đầy đủ
            </Link>
          </div>
          {dashboard.branches.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-3">Cơ sở</th>
                    <th className="border-b border-slate-200 px-3 py-3 text-right">Doanh số</th>
                    <th className="border-b border-slate-200 px-3 py-3 text-right">Thiếu công</th>
                    <th className="border-b border-slate-200 px-3 py-3">Payroll</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.branches.map((branch) => (
                    <tr key={branch.id}>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <span className="font-semibold">{branch.code}</span>
                        <span className="ml-2 text-slate-500">{branch.name}</span>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right">
                        {money(branch.revenueAmount)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right">
                        {branch.missingAttendance}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        {branch.payrollStatus ?? "Chưa tạo"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              Chưa có dữ liệu cơ sở trong tháng này.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Rule sắp hiệu lực</h2>
          <p className="mt-1 text-sm text-slate-500">Trong 30 ngày tới</p>
          {dashboard.upcomingRules.length ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {dashboard.upcomingRules.slice(0, 6).map((rule) => (
                <li className="py-3" key={rule.id}>
                  <p className="text-sm font-semibold text-slate-900">{rule.ruleSetName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Version {rule.versionNo} · hiệu lực {rule.effectiveFrom}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
              Không có rule mới sắp hiệu lực.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function ManagerDashboard({
  branch,
  branchCount,
  staffCount,
}: Readonly<{
  branch: BranchMonthlyOverviewDto | null;
  branchCount: number;
  staffCount: number;
}>) {
  const today = toBusinessDateString(new Date());
  const missingAttendance =
    branch?.rows.reduce(
      (total, row) =>
        total +
        row.days.filter((day) => day.businessDate <= today && day.attendanceId === null).length,
      0,
    ) ?? 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryCard label="Cơ sở được phân công" value={String(branchCount)} />
        <SummaryCard label="Nhân sự trong phạm vi" value={String(staffCount)} />
        <SummaryCard label="Doanh số tháng" value={money(branch?.totals.revenueAmount ?? "0")} />
        <SummaryCard label="Tổng công" value={decimal(branch?.totals.workUnits ?? "0")} />
        <SummaryCard
          label="Thời lượng Live"
          value={minutes(branch?.totals.actualLiveMinutes ?? 0)}
        />
        <SummaryCard
          label="Thiếu chấm công"
          tone={missingAttendance > 0 ? "danger" : "success"}
          value={String(missingAttendance)}
        />
      </div>
      {branch ? (
        <p className="mt-4 text-sm text-slate-500">
          Số liệu nhanh đang hiển thị cơ sở <strong>{branch.branch.name}</strong>, tháng{" "}
          {branch.month}. Dùng trang Tổng quan cơ sở để đổi cơ sở hoặc lọc chi tiết.
        </p>
      ) : (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Chưa có cơ sở hiệu lực trong phạm vi tài khoản này.
        </p>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ActionLink
          description="Cập nhật attendance, Live, công, tăng ca và ghi nhận lỗi theo từng ngày."
          href="/attendance"
          label="Nhập chấm công tháng"
        />
        <ActionLink
          description="Kiểm tra tổng doanh số, công, Live và tiền phạt của toàn cơ sở."
          href="/branch-overview"
          label="Kiểm tra bảng tổng quan"
        />
      </div>
    </>
  );
}

function EmployeeDashboard({ period }: Readonly<{ period: PayrollPeriodDto | null }>) {
  const entry = period?.entries[0] ?? null;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">Phiếu lương gần nhất</p>
        {period && entry ? (
          <>
            <p className="mt-3 text-lg font-semibold text-slate-950">
              Tháng {period.month} · {period.branch.name}
            </p>
            <p className="mt-4 text-3xl font-semibold text-sky-800">{money(entry.totalIncome)}</p>
            <p className="mt-2 text-sm text-slate-500">Thu nhập sau phạt và tạm ứng</p>
          </>
        ) : (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            Chưa có phiếu lương được publish hoặc tính năng self-service đang tắt.
          </p>
        )}
        <Link className="mt-5 inline-block text-sm font-semibold text-sky-700" href="/my-payslips">
          Mở phiếu lương của tôi →
        </Link>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <ActionLink
          description="Xem breakdown ngày, thưởng, phạt và file payslip đã publish."
          href="/my-payslips"
          label="Phiếu lương đã công bố"
        />
        <ActionLink
          description="Đổi mật khẩu và kiểm tra chính sách bảo vệ tài khoản."
          href="/settings/security"
          label="Bảo mật tài khoản"
        />
      </section>
    </div>
  );
}

export default async function DashboardPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"]);
  const month = toBusinessDateString(new Date()).slice(0, 7);

  if (actor.role === "GENERAL_MANAGER") {
    const dashboard = await getCompanyDashboard(actor, { month });
    return (
      <>
        <PageHeader
          description="Theo dõi doanh số, công, phạt, payroll và các việc cần xử lý trong tháng."
          eyebrow="Trung tâm điều hành"
          title="Tổng quan công ty"
        />
        <GeneralManagerDashboard dashboard={dashboard} />
      </>
    );
  }

  if (actor.role === "TRAINING_MANAGER") {
    const [branches, staff] = await Promise.all([
      listBranches(actor),
      listStaff(actor, new Date()),
    ]);
    const firstBranch = branches[0];
    const branch = firstBranch
      ? await getBranchMonthlyOverview(actor, { branchId: firstBranch.id, month })
      : null;
    return (
      <>
        <PageHeader
          description="Theo dõi nhanh phạm vi được phân công và tiếp tục các tác vụ vận hành tháng."
          eyebrow="Không gian quản lý"
          title="Tổng quan cơ sở"
        />
        <ManagerDashboard branch={branch} branchCount={branches.length} staffCount={staff.length} />
      </>
    );
  }

  let recentPeriod: PayrollPeriodDto | null = null;
  try {
    recentPeriod = (await listPayrollPeriods(actor, {}))[0] ?? null;
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "FORBIDDEN") throw error;
  }
  return (
    <>
      <PageHeader
        description="Xem thông tin đã được công bố và quản lý bảo mật tài khoản cá nhân."
        eyebrow="Không gian cá nhân"
        title="Tổng quan của tôi"
      />
      <EmployeeDashboard period={recentPeriod} />
    </>
  );
}
