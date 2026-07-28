"use client";

import type {
  CompanyDashboardDto,
  CompanyMonthlyReportDto,
  PerformanceLevelOptionDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  compactChartNumber,
  responsiveTooltipStyle,
  truncateChartLabel,
} from "./chart-format";
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

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN").format(BigInt(value));
}

function coins(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} xu`;
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "Không thể tải dữ liệu.");
  }
  return payload.data;
}

export function CompanyIntelligenceWorkspace({
  branches,
}: Readonly<{ branches: readonly BranchOption[] }>) {
  const [month, setMonth] = useState(currentMonth);
  const [branchId, setBranchId] = useState("");
  const [employmentCategory, setEmploymentCategory] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [levelId, setLevelId] = useState("");
  const [levels, setLevels] = useState<readonly PerformanceLevelOptionDto[]>([]);
  const [dashboard, setDashboard] = useState<CompanyDashboardDto | null>(null);
  const [report, setReport] = useState<CompanyMonthlyReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const reportParams = useMemo(() => {
    const params = new URLSearchParams({ month });
    if (branchId) params.set("branchId", branchId);
    if (employmentCategory) params.set("employmentCategory", employmentCategory);
    if (employmentStatus) params.set("employmentStatus", employmentStatus);
    if (levelId) params.set("levelId", levelId);
    return params;
  }, [branchId, employmentCategory, employmentStatus, levelId, month]);

  const load = useCallback(async (silent = false) => {
    const sequence = ++loadSequence.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const dashboardParams = new URLSearchParams({ month });
      if (branchId) dashboardParams.set("branchId", branchId);
      const [dashboardData, reportData, levelData] = await Promise.all([
        fetch(`/api/company-dashboard?${dashboardParams}`, { cache: "no-store" }).then(
          responseData<CompanyDashboardDto>,
        ),
        fetch(`/api/company-report?${reportParams}`, { cache: "no-store" }).then(
          responseData<CompanyMonthlyReportDto>,
        ),
        fetch("/api/rules/configured/levels", { cache: "no-store" }).then(
          responseData<readonly PerformanceLevelOptionDto[]>,
        ),
      ]);
      if (sequence !== loadSequence.current) return;
      setDashboard(dashboardData);
      setReport(reportData);
      setLevels(levelData);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "Không thể tải báo cáo.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [branchId, month, reportParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useReportingAutoRefresh(() => load(true));

  const branchChart =
    report?.charts.revenueByBranch.map((item) => ({
      name: item.label,
      value: Number(item.value),
    })) ?? [];
  const employeeChart =
    report?.charts.revenueByEmployee.slice(0, 10).map((item) => ({
      name: item.label,
      value: Number(item.value),
    })) ?? [];
  const trendChart =
    report?.charts.revenueTrend.map((item) => ({
      date: item.businessDate.slice(8, 10),
      value: Number(item.value),
    })) ?? [];
  const bonusChart =
    report?.charts.bonusPenalty.map((item) => ({
      name: item.label,
      bonus: Number(item.bonus),
      penalty: Number(item.penalty),
    })) ?? [];

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            GM Intelligence
          </p>
          <h2 className="mt-1 text-xl font-semibold">Dashboard và báo cáo toàn công ty</h2>
          <p className="mt-1 text-sm text-slate-500">
            Projection trực tiếp từ attendance, live metrics và payroll snapshot.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={loading}
            onClick={() => void load()}
            type="button"
            variant="outline-sky"
          >
            {loading ? "Đang cập nhật…" : "Cập nhật ngay"}
          </Button>
          <a
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            href={`/api/exports/company-report?${reportParams}&format=xlsx`}
          >
            Xuất XLSX
          </a>
          <a
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            href={`/api/exports/company-report?${reportParams}&format=pdf`}
          >
            Xuất PDF
          </a>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Tự động đồng bộ khi quay lại trang và mỗi 30 giây
        {report
          ? ` · Dữ liệu server lúc ${new Intl.DateTimeFormat("vi-VN", {
              dateStyle: "short",
              timeStyle: "medium",
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date(report.generatedAt))}`
          : ""}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <label className="grid gap-1 text-sm">
          Tháng
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Cơ sở
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Toàn công ty</option>
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
        <label className="grid gap-1 text-sm">
          Level
          <select value={levelId} onChange={(event) => setLevelId(event.target.value)}>
            <option value="">Tất cả</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.code} — {level.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="mt-5 break-words rounded-xl bg-rose-50 p-4 text-sm text-rose-700 [overflow-wrap:anywhere]">
          {error}
        </div>
      ) : loading || !dashboard || !report ? (
        <p className="mt-5 text-sm text-slate-500">Đang tổng hợp báo cáo…</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Tổng xu", coins(dashboard.totals.revenueAmount)],
              ["Tổng công", dashboard.totals.workUnits],
              ["Tiền phạt", money(dashboard.totals.penalties)],
              ["Payroll", money(dashboard.totals.payrollTotal)],
              ["Thiếu chấm công", String(dashboard.totals.missingAttendance)],
              ["Payroll chưa review", String(dashboard.totals.unreviewedPayroll)],
            ].map(([label, value]) => (
              <div
                className="min-w-0 rounded-xl bg-slate-50 p-4 [overflow-wrap:anywhere]"
                key={label}
              >
                <div className="break-words text-xs uppercase tracking-wide text-slate-500">
                  {label}
                </div>
                <div className="mt-2 break-words text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {[
              ["Tổng xu theo cơ sở", branchChart, "bar"],
              ["Top xu nhân viên", employeeChart, "bar"],
              ["Xu hướng xu theo ngày", trendChart, "line"],
              ["Thưởng và phạt theo cơ sở", bonusChart, "breakdown"],
            ].map(([title, data, kind]) => (
              <div
                className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4"
                key={String(title)}
              >
                <h3 className="break-words font-medium [overflow-wrap:anywhere]">
                  {String(title)}
                </h3>
                <div className="mt-3 h-64 min-w-0 overflow-hidden">
                  <ResponsiveContainer height="100%" width="100%">
                    {kind === "line" ? (
                      <LineChart
                        data={data as typeof trendChart}
                        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" minTickGap={12} tick={{ fontSize: 11 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={compactChartNumber}
                          width={68}
                        />
                        <Tooltip
                          contentStyle={responsiveTooltipStyle}
                          formatter={(value) =>
                            new Intl.NumberFormat("vi-VN").format(Number(value))
                          }
                          itemStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          labelStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          wrapperStyle={{ maxWidth: "calc(100vw - 2rem)", zIndex: 60 }}
                        />
                        <Line dataKey="value" dot={false} stroke="#0284C7" strokeWidth={2} />
                      </LineChart>
                    ) : (
                      <BarChart
                        data={data as typeof bonusChart}
                        margin={{ top: 8, right: 8, bottom: 20, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name"
                          height={48}
                          interval="preserveStartEnd"
                          minTickGap={16}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => truncateChartLabel(value, 14)}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={compactChartNumber}
                          width={68}
                        />
                        <Tooltip
                          contentStyle={responsiveTooltipStyle}
                          formatter={(value) =>
                            new Intl.NumberFormat("vi-VN").format(Number(value))
                          }
                          itemStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          labelStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          wrapperStyle={{ maxWidth: "calc(100vw - 2rem)", zIndex: 60 }}
                        />
                        {kind === "breakdown" ? (
                          <>
                            <Legend
                              wrapperStyle={{
                                maxWidth: "100%",
                                overflowWrap: "anywhere",
                                whiteSpace: "normal",
                              }}
                            />
                            <Bar dataKey="bonus" fill="#0EA5E9" name="Thưởng" />
                            <Bar dataKey="penalty" fill="#F43F5E" name="Phạt" />
                          </>
                        ) : (
                          <Bar dataKey="value" fill="#0284C7" name="Số xu" />
                        )}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-3">Cơ sở</th>
                  <th className="px-3 py-3">Tổng xu</th>
                  <th className="px-3 py-3">Công</th>
                  <th className="px-3 py-3">Phạt</th>
                  <th className="px-3 py-3">Payroll</th>
                  <th className="px-3 py-3">Thiếu CC</th>
                  <th className="px-3 py-3">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.branches.map((branch) => (
                  <tr className="border-t border-slate-100" key={branch.id}>
                    <td className="px-3 py-3">
                      <Button
                        className="max-w-64 whitespace-normal break-words text-left [overflow-wrap:anywhere]"
                        onClick={() => setBranchId(branch.id)}
                        size="compact"
                        variant="link"
                      >
                        {branch.code} — {branch.name}
                      </Button>
                    </td>
                    <td className="px-3 py-3">{coins(branch.revenueAmount)}</td>
                    <td className="px-3 py-3">{branch.workUnits}</td>
                    <td className="px-3 py-3">{money(branch.penalties)}</td>
                    <td className="px-3 py-3">{money(branch.payrollTotal)}</td>
                    <td className="px-3 py-3">{branch.missingAttendance}</td>
                    <td className="px-3 py-3">{branch.payrollStatus ?? "Chưa có"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-4">
            {report.branches.map((branch) => (
              <details
                className="min-w-0 rounded-xl border border-slate-200 p-4 [overflow-wrap:anywhere]"
                key={branch.branch.id}
              >
                <summary className="cursor-pointer break-words font-medium">
                  {branch.branch.code} — {branch.branch.name} · {branch.staff.length} nhân viên
                </summary>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Nhân viên</th>
                        {report.weeks.map((week) => (
                          <th className="px-3 py-2 text-right" key={week.weekNo}>
                            Tuần {week.weekNo}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right">Tổng xu tháng</th>
                        <th className="px-3 py-2 text-right">Thưởng xu</th>
                        <th className="px-3 py-2 text-right">Thưởng tháng</th>
                        <th className="px-3 py-2 text-right">Lương CB</th>
                        <th className="px-3 py-2 text-right">Thu nhập</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branch.staff.map((row) => (
                        <tr className="border-t border-slate-100" key={row.staff.id}>
                          <td className="px-3 py-2">
                            {row.staff.staffCode} — {row.staff.fullName}
                            <div className="text-xs text-slate-500">
                              {row.staff.employmentStatus} ·{" "}
                              {row.staff.performanceLevel?.name ?? "Chưa xếp hạng"}
                            </div>
                          </td>
                          {row.weeks.map((week) => (
                            <td className="px-3 py-2 text-right" key={week.weekNo}>
                              {coins(week.revenueAmount)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right">
                            {coins(row.totals.revenueAmount)}
                          </td>
                          <td className="px-3 py-2 text-right">{money(row.totals.revenueBonus)}</td>
                          <td className="px-3 py-2 text-right">{money(row.totals.monthlyBonus)}</td>
                          <td className="px-3 py-2 text-right">{money(row.totals.baseSalary)}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {money(row.totals.totalIncome)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>

          <div className="mt-6 rounded-xl bg-amber-50 p-4">
            <h3 className="font-medium text-amber-900">Rule sắp hiệu lực trong 30 ngày</h3>
            {dashboard.upcomingRules.length === 0 ? (
              <p className="mt-2 text-sm text-amber-800">Không có rule sắp hiệu lực.</p>
            ) : (
              <ul className="mt-2 text-sm text-amber-900">
                {dashboard.upcomingRules.map((rule) => (
                  <li key={rule.id}>
                    {rule.effectiveFrom} · {rule.type} · {rule.ruleSetName} v{rule.versionNo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
