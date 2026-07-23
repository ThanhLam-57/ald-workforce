"use client";

import type { PayrollExportJobDto, PayrollPeriodDto } from "@ald/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

type BranchOption = Readonly<{ id: string; code: string; name: string }>;

const statusLabels = {
  DRAFT: "Nháp",
  CALCULATED: "Đã tính",
  REVIEWED: "Đã review",
  LOCKED: "Đã khóa",
  PUBLISHED: "Đã publish",
} as const;

const lineLabels = {
  BASE_SALARY: "Lương cơ bản",
  PRORATED_SALARY: "Lương theo công",
  DAILY_REVENUE_BONUS: "Thưởng ngày",
  MONTHLY_REVENUE_BONUS: "Thưởng tháng",
  ATTENDANCE_BONUS: "Chuyên cần",
  ACHIEVEMENT_BONUS: "Thành tích",
  LEVEL_BONUS: "Level",
  OVERTIME_PAY: "Tăng ca",
  OTHER_BONUS: "Thưởng / điều chỉnh",
  PENALTY: "Phạt",
  ADVANCE: "Tạm ứng",
  TOTAL_INCOME: "Thực nhận",
} as const;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: string | null): string {
  return value === null
    ? "Ẩn theo chính sách"
    : `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "Không thể tải dữ liệu payroll.");
  }
  return payload.data;
}

export function PayrollWorkspace({
  branches,
  isGeneralManager,
}: Readonly<{
  branches: readonly BranchOption[];
  isGeneralManager: boolean;
}>) {
  const [month, setMonth] = useState(currentMonth);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [periods, setPeriods] = useState<readonly PayrollPeriodDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<readonly PayrollExportJobDto[]>([]);
  const [reason, setReason] = useState("Xử lý kỳ lương theo quy trình");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0");
  const [adjustmentType, setAdjustmentType] = useState<"OTHER_BONUS" | "ADVANCE" | "CORRECTION">(
    "OTHER_BONUS",
  );
  const [adjustmentStaffId, setAdjustmentStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => periods.find((period) => period.id === selectedId) ?? periods[0] ?? null,
    [periods, selectedId],
  );
  const effectiveAdjustmentStaffId = adjustmentStaffId || selected?.entries[0]?.staff.id || "";

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (isGeneralManager && branchId) params.set("branchId", branchId);
      const result = await api<readonly PayrollPeriodDto[]>(
        `/api/payroll/periods?${params.toString()}`,
      );
      setPeriods(result);
      setSelectedId((current) =>
        current && result.some((period) => period.id === current)
          ? current
          : (result[0]?.id ?? null),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tải kỳ lương.");
      setPeriods([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, isGeneralManager, month]);

  const loadJobs = useCallback(async (periodId: string) => {
    try {
      const result = await api<readonly PayrollExportJobDto[]>(
        `/api/payroll/periods/${periodId}/exports`,
      );
      setJobs(result);
    } catch {
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadPeriods(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadPeriods]);

  useEffect(() => {
    if (!selected?.id) return;
    const timeout = window.setTimeout(() => void loadJobs(selected.id), 0);
    return () => window.clearTimeout(timeout);
  }, [loadJobs, selected?.id]);

  useEffect(() => {
    if (
      !selected?.id ||
      !jobs.some((job) => job.status === "QUEUED" || job.status === "PROCESSING")
    ) {
      return;
    }
    const timer = window.setInterval(() => void loadJobs(selected.id), 1_500);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs, selected?.id]);

  async function createPeriod(): Promise<void> {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<PayrollPeriodDto>("/api/payroll/periods", {
        method: "POST",
        body: JSON.stringify({ branchId, month, reason }),
      });
      await loadPeriods();
      setSelectedId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo kỳ lương.");
    } finally {
      setBusy(false);
    }
  }

  async function periodAction(action: "calculate" | "review" | "lock" | "publish"): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<PayrollPeriodDto>(`/api/payroll/periods/${selected.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ version: selected.version, reason }),
      });
      setPeriods((current) =>
        current.map((period) => (period.id === updated.id ? updated : period)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể chuyển trạng thái.");
    } finally {
      setBusy(false);
    }
  }

  async function createRevision(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const revision = await api<PayrollPeriodDto>(
        `/api/payroll/periods/${selected.id}/revisions`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      await loadPeriods();
      setSelectedId(revision.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo revision.");
    } finally {
      setBusy(false);
    }
  }

  async function addAdjustment(): Promise<void> {
    if (!selected || !effectiveAdjustmentStaffId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<PayrollPeriodDto>(
        `/api/payroll/periods/${selected.id}/adjustments`,
        {
          method: "POST",
          body: JSON.stringify({
            staffId: effectiveAdjustmentStaffId,
            type: adjustmentType,
            amount: adjustmentAmount,
            reason,
            periodVersion: selected.version,
          }),
        },
      );
      await loadPeriods();
      setSelectedId(updated.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo adjustment.");
    } finally {
      setBusy(false);
    }
  }

  async function requestExport(
    kind: "PAYSLIP_XLSX" | "PAYSLIP_PDF" | "BULK_ZIP",
    staffId?: string,
  ): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api<PayrollExportJobDto>(`/api/payroll/periods/${selected.id}/exports`, {
        method: "POST",
        body: JSON.stringify({ kind, staffId: staffId ?? null, reason }),
      });
      await loadJobs(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo export.");
    } finally {
      setBusy(false);
    }
  }

  async function download(jobId: string): Promise<void> {
    try {
      const result = await api<{ url: string }>(`/api/payroll/exports/${jobId}/download`);
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tải file.");
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Payroll ledger
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {isGeneralManager ? "Review, khóa và publish lương" : "Phiếu lương của tôi"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Snapshot bất biến · tiền VND nguyên · revision có audit
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isGeneralManager ? (
            <select
              aria-label="Chọn cơ sở payroll"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onChange={(event) => setBranchId(event.target.value)}
              value={branchId}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            aria-label="Tháng payroll"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onChange={(event) => setMonth(event.target.value)}
            type="month"
            value={month}
          />
          {isGeneralManager ? (
            <button
              className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy || !branchId}
              onClick={() => void createPeriod()}
              type="button"
            >
              Tạo kỳ
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">Đang tải payroll…</p> : null}
      {!loading && periods.length === 0 && !error ? (
        <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
          {isGeneralManager
            ? "Chưa có kỳ lương cho cơ sở/tháng đã chọn."
            : "Chưa có phiếu lương đã publish hoặc self-service chưa được bật."}
        </p>
      ) : null}

      {periods.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {periods.map((period) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-sm ${
                selected?.id === period.id
                  ? "border-sky-600 bg-sky-50 text-sky-800"
                  : "border-slate-200 text-slate-600"
              }`}
              key={period.id}
              onClick={() => setSelectedId(period.id)}
              type="button"
            >
              {period.branch.code} · R{period.revision} · {statusLabels[period.status]}
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Nhân viên", String(selected.totals.staffCount)],
              ["Gross", money(selected.totals.grossIncome)],
              ["Tiền phạt", money(selected.totals.penalties)],
              ["Tạm ứng", money(selected.totals.advance)],
              ["Thực nhận", money(selected.totals.totalIncome)],
            ].map(([label, value]) => (
              <div className="rounded-xl border border-slate-200 p-3" key={label}>
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 font-semibold">{value}</div>
              </div>
            ))}
          </div>

          {isGeneralManager ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="block text-xs font-medium text-slate-600" htmlFor="payroll-reason">
                Lý do mutation / export
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                id="payroll-reason"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.status === "DRAFT" ||
                selected.status === "CALCULATED" ||
                selected.status === "REVIEWED" ? (
                  <button
                    className="rounded-lg bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void periodAction("calculate")}
                    type="button"
                  >
                    Tính / tính lại
                  </button>
                ) : null}
                {selected.status === "CALCULATED" ? (
                  <button
                    className="rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void periodAction("review")}
                    type="button"
                  >
                    Xác nhận review
                  </button>
                ) : null}
                {selected.status === "REVIEWED" ? (
                  <button
                    className="rounded-lg bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void periodAction("lock")}
                    type="button"
                  >
                    Khóa kỳ
                  </button>
                ) : null}
                {selected.status === "LOCKED" ? (
                  <button
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void periodAction("publish")}
                    type="button"
                  >
                    Publish payslip
                  </button>
                ) : null}
                {selected.status === "LOCKED" || selected.status === "PUBLISHED" ? (
                  <button
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void createRevision()}
                    type="button"
                  >
                    Tạo revision
                  </button>
                ) : null}
                {selected.entries.length > 0 ? (
                  <button
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void requestExport("BULK_ZIP")}
                    type="button"
                  >
                    Export bulk ZIP
                  </button>
                ) : null}
              </div>
              {selected.entries.length > 0 ? (
                <div className="mt-4 grid gap-2 md:grid-cols-[1fr_150px_180px_auto]">
                  <select
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    onChange={(event) => setAdjustmentStaffId(event.target.value)}
                    value={effectiveAdjustmentStaffId}
                  >
                    {selected.entries.map((entry) => (
                      <option key={entry.staff.id} value={entry.staff.id}>
                        {entry.staff.staffCode} — {entry.staff.fullName}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    onChange={(event) =>
                      setAdjustmentType(event.target.value as typeof adjustmentType)
                    }
                    value={adjustmentType}
                  >
                    <option value="OTHER_BONUS">Thưởng khác</option>
                    <option value="ADVANCE">Tạm ứng</option>
                    <option value="CORRECTION">Điều chỉnh</option>
                  </select>
                  <input
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    inputMode="numeric"
                    onChange={(event) => setAdjustmentAmount(event.target.value)}
                    value={adjustmentAmount}
                  />
                  <button
                    className="rounded-lg border border-sky-600 bg-white px-3 py-2 text-sm text-sky-800 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void addAdjustment()}
                    type="button"
                  >
                    Thêm adjustment
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="sticky left-0 bg-slate-100 px-3 py-3">Nhân viên</th>
                  <th className="px-3 py-3">Công</th>
                  <th className="px-3 py-3">OT</th>
                  <th className="px-3 py-3">Lương công</th>
                  <th className="px-3 py-3">Thưởng</th>
                  <th className="px-3 py-3">Phạt</th>
                  <th className="px-3 py-3">Tạm ứng</th>
                  <th className="px-3 py-3">Thực nhận</th>
                  <th className="px-3 py-3">So lần trước</th>
                  <th className="px-3 py-3">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.entries.map((entry) => {
                  const bonus =
                    BigInt(entry.dailyRevenueBonus) +
                    BigInt(entry.monthlyRevenueBonus) +
                    BigInt(entry.attendanceBonus) +
                    BigInt(entry.achievementBonus) +
                    BigInt(entry.levelBonus) +
                    BigInt(entry.overtimePay) +
                    BigInt(entry.otherBonus);
                  return (
                    <tr key={entry.id}>
                      <td className="sticky left-0 bg-white px-3 py-3">
                        <div className="font-medium">{entry.staff.fullName}</div>
                        <div className="text-xs text-slate-500">
                          {entry.staff.staffCode} · calc #{entry.calculationNo}
                        </div>
                        {entry.anomalyFlags.length > 0 ? (
                          <div className="mt-1 text-xs text-amber-700">
                            {entry.anomalyFlags.join(", ")}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">{entry.workUnits}</td>
                      <td className="px-3 py-3">{entry.overtimeMinutes}′</td>
                      <td className="px-3 py-3">{money(entry.proratedSalary)}</td>
                      <td className="px-3 py-3">{money(bonus.toString())}</td>
                      <td className="px-3 py-3 text-rose-700">{money(entry.penalties)}</td>
                      <td className="px-3 py-3 text-rose-700">{money(entry.advance)}</td>
                      <td className="px-3 py-3 font-semibold">{money(entry.totalIncome)}</td>
                      <td className="px-3 py-3">
                        {entry.deltaFromPrevious === null ? "—" : money(entry.deltaFromPrevious)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <button
                            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void requestExport("PAYSLIP_XLSX", entry.staff.id)}
                            type="button"
                          >
                            XLSX
                          </button>
                          <button
                            className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void requestExport("PAYSLIP_PDF", entry.staff.id)}
                            type="button"
                          >
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.entries.map((entry) => (
            <details className="mt-3 rounded-xl border border-slate-200 p-4" key={entry.id}>
              <summary className="cursor-pointer font-medium">
                Breakdown · {entry.staff.staffCode} — {entry.staff.fullName}
              </summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Dòng tính
                  </h3>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {entry.lines.map((line) => (
                      <li className="flex justify-between gap-4 py-2" key={line.id}>
                        <span>
                          {lineLabels[line.type]} · {line.label}
                        </span>
                        <span
                          className={
                            line.type === "PENALTY" || line.type === "ADVANCE"
                              ? "text-rose-700"
                              : ""
                          }
                        >
                          {money(line.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Ngày công
                  </h3>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {entry.dailyRows.map((row) => (
                      <li
                        className="grid grid-cols-[90px_1fr_auto] gap-2 py-2"
                        key={row.businessDate}
                      >
                        <span>
                          {row.businessDate.slice(8, 10)}/{row.businessDate.slice(5, 7)}
                        </span>
                        <span>
                          {row.workUnits} công · OT {row.overtimeMinutes}′
                        </span>
                        <span>{money(row.dailyRevenueBonus)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          ))}

          {jobs.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Export jobs</h3>
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
                {jobs.map((job) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                    key={job.id}
                  >
                    <span>
                      {job.kind} · {job.status} · {job.progress}%
                      {job.errorMessage ? ` · ${job.errorMessage}` : ""}
                    </span>
                    {job.status === "COMPLETED" ? (
                      <button
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white"
                        onClick={() => void download(job.id)}
                        type="button"
                      >
                        Tải {job.fileName}
                      </button>
                    ) : (
                      <div className="h-2 w-36 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-sky-600" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
