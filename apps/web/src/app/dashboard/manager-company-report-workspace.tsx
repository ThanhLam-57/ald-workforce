"use client";

import type { ManagerCompanyReportDto } from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useReportingAutoRefresh } from "./use-reporting-auto-refresh";

type BranchOption = Readonly<{ id: string; code: string; name: string }>;

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function number(value: string): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value));
}

function coins(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} xu`;
}

function money(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

function duration(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

async function responseData<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Vui lòng đăng nhập lại hoặc thử lại.");
  }
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "Không thể tải báo cáo.");
  }
  return payload.data;
}

function MetricCard({
  label,
  value,
  warning = false,
}: Readonly<{ label: string; value: string; warning?: boolean }>) {
  return (
    <article
      className={`min-w-0 rounded-xl border p-4 [overflow-wrap:anywhere] ${
        warning ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="break-words text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-words text-xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}

export function ManagerCompanyReportWorkspace({
  branches,
}: Readonly<{ branches: readonly BranchOption[] }>) {
  const [month, setMonth] = useState(currentMonth);
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.id : "");
  const [employmentCategory, setEmploymentCategory] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [report, setReport] = useState<ManagerCompanyReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const params = useMemo(() => {
    const value = new URLSearchParams({ month });
    if (branchId) value.set("branchId", branchId);
    if (employmentCategory) value.set("employmentCategory", employmentCategory);
    if (employmentStatus) value.set("employmentStatus", employmentStatus);
    return value;
  }, [branchId, employmentCategory, employmentStatus, month]);

  const load = useCallback(
    async (silent = false) => {
      const sequence = ++loadSequence.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await fetch(`/api/company-report?${params}`, {
          cache: "no-store",
        }).then(responseData<ManagerCompanyReportDto>);
        if (sequence === loadSequence.current) setReport(data);
      } catch (loadError) {
        if (sequence === loadSequence.current) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải báo cáo.");
        }
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useReportingAutoRefresh(() => load(true));

  const maximumBranchRevenue = report
    ? report.charts.revenueByBranch.reduce(
        (maximum, item) => (BigInt(item.value) > maximum ? BigInt(item.value) : maximum),
        0n,
      )
    : 0n;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              Báo cáo vận hành
            </p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Phạm vi được phân công · Chỉ xem
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold">Tổng hợp các cơ sở của bạn</h2>
          <p className="mt-1 text-sm text-slate-500">
            Dữ liệu trực tiếp từ chấm công, Live và vi phạm; không bao gồm thông tin lương.
          </p>
        </div>
        <Button
          disabled={loading}
          onClick={() => void load()}
          type="button"
          variant="outline-sky"
        >
          {loading ? "Đang cập nhật…" : "Cập nhật ngay"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Tự động cập nhật khi quay lại trang và mỗi 30 giây
        {report
          ? ` · Dữ liệu lúc ${new Intl.DateTimeFormat("vi-VN", {
              dateStyle: "short",
              timeStyle: "medium",
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date(report.generatedAt))}`
          : ""}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Tháng
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Cơ sở
          <select
            disabled={branches.length === 1}
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.length !== 1 ? <option value="">Tất cả cơ sở được phân công</option> : null}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Loại nhân sự
          <select
            value={employmentCategory}
            onChange={(event) => setEmploymentCategory(event.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="OFFICIAL">Chính thức</option>
            <option value="PROBATION">Thử việc</option>
            <option value="CONTRACTOR">Hợp đồng</option>
            <option value="INTERN">Thực tập</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Trạng thái
          <select
            value={employmentStatus}
            onChange={(event) => setEmploymentStatus(event.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="ACTIVE">Đang làm</option>
            <option value="ON_LEAVE">Tạm nghỉ</option>
            <option value="TERMINATED">Đã nghỉ</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="mt-5 break-words rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 [overflow-wrap:anywhere]">
          {error}
        </div>
      ) : null}

      {report ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Tổng xu" value={coins(report.totals.revenueAmount)} />
            <MetricCard label="Tổng công" value={number(report.totals.workUnits)} />
            <MetricCard label="Live (HH:mm)" value={duration(report.totals.actualLiveMinutes)} />
            <MetricCard label="Tăng ca (HH:mm)" value={duration(report.totals.overtimeMinutes)} />
            <MetricCard
              label="Phạt đang hiệu lực"
              value={money(report.totals.penalties)}
              warning={BigInt(report.totals.penalties) > 0n}
            />
            <MetricCard
              label="Thiếu chấm công"
              value={String(report.totals.missingAttendance)}
              warning={report.totals.missingAttendance > 0}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-950">Xu theo cơ sở</h3>
              <div className="mt-4 space-y-3">
                {report.charts.revenueByBranch.map((item) => {
                  const width =
                    maximumBranchRevenue === 0n
                      ? 0
                      : Number((BigInt(item.value) * 100n) / maximumBranchRevenue);
                  return (
                    <div key={item.id}>
                      <div className="flex min-w-0 items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                          {item.label}
                        </span>
                        <span className="shrink-0 text-right">{coins(item.value)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-sky-600"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {report.charts.revenueByBranch.length === 0 ? (
                  <p className="text-sm text-slate-500">Chưa có dữ liệu trong phạm vi này.</p>
                ) : null}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="font-semibold text-slate-950">Nhân viên có xu cao nhất</h3>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Nhân viên</th>
                      <th className="px-4 py-3 text-right">Tổng xu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.charts.revenueByEmployee.map((item) => (
                      <tr className="border-t border-slate-100" key={item.id}>
                        <td className="max-w-sm break-words px-4 py-3 [overflow-wrap:anywhere]">
                          {item.label}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{coins(item.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="mt-6 space-y-5">
            {report.branches.map((branch) => (
              <section
                className="overflow-hidden rounded-xl border border-slate-200"
                key={branch.branch.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h3 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
                    {branch.branch.code} — {branch.branch.name}
                  </h3>
                  <span className="break-words text-sm text-slate-600 [overflow-wrap:anywhere]">
                    {branch.staff.length} nhân viên · {coins(branch.totals.revenueAmount)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Nhân viên</th>
                        {report.weeks.map((week) => (
                          <th className="px-3 py-3 text-right" key={week.weekNo}>
                            Tuần {week.weekNo}
                          </th>
                        ))}
                        <th className="px-3 py-3 text-right">Công</th>
                        <th className="px-3 py-3 text-right">Live</th>
                        <th className="px-3 py-3 text-right">Tăng ca</th>
                        <th className="px-3 py-3 text-right">Phạt</th>
                        <th className="px-3 py-3 text-right">Thiếu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branch.staff.map((row) => (
                        <tr className="border-t border-slate-100" key={row.staff.id}>
                          <td className="max-w-72 break-words px-3 py-3 [overflow-wrap:anywhere]">
                            <p className="break-words font-semibold">{row.staff.fullName}</p>
                            <p className="break-words text-xs text-slate-500">
                              {row.staff.staffCode}
                            </p>
                          </td>
                          {row.weeks.map((week) => (
                            <td className="px-3 py-3 text-right" key={week.weekNo}>
                              {coins(week.revenueAmount)}
                            </td>
                          ))}
                          <td className="px-3 py-3 text-right">{number(row.totals.workUnits)}</td>
                          <td className="px-3 py-3 text-right">
                            {duration(row.totals.actualLiveMinutes)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {duration(row.totals.overtimeMinutes)}
                          </td>
                          <td className="px-3 py-3 text-right">{money(row.totals.penalties)}</td>
                          <td className="px-3 py-3 text-right">{row.totals.missingAttendance}</td>
                        </tr>
                      ))}
                      {branch.staff.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-8 text-center text-slate-500"
                            colSpan={report.weeks.length + 6}
                          >
                            Không có nhân viên phù hợp bộ lọc.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : loading ? (
        <div className="mt-5 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
          Đang tải dữ liệu trong phạm vi được phân công…
        </div>
      ) : null}
    </section>
  );
}
