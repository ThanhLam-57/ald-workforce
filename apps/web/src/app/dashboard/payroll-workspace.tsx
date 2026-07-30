"use client";

import type {
  PayrollDailyRowDto,
  PayrollExportJobDto,
  PayrollPeriodDto,
  PayrollWorksheetValues,
} from "@ald/contracts";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  durationInputError,
  isDurationInputDraft,
  parseDurationMinutes,
} from "./attendance-duration";

type BranchOption = Readonly<{ id: string; code: string; name: string }>;
type DayOverride = PayrollWorksheetValues["days"][number];
type DayField = Exclude<keyof DayOverride, "businessDate">;
type ComponentField = keyof PayrollWorksheetValues["components"];

const emptyWorksheet = (): PayrollWorksheetValues => ({ days: [], components: {} });

const statusLabels = {
  DRAFT: "Đang làm",
  CALCULATED: "Đã lưu",
  REVIEWED: "Đã lưu",
  LOCKED: "Đã gửi",
  PUBLISHED: "Đã gửi",
} as const;

const transitionLabels = {
  NONE: "Chưa xác định",
  RETAIN: "Giữ bậc",
  JUMP: "Tăng bậc",
  DOWN: "Giảm bậc",
} as const;

const previousCoinSourceLabels = {
  PUBLISHED_PAYROLL: "Phiếu lương đã gửi tháng trước",
  ATTENDANCE_LIVE: "Tự động từ Chấm công & Live",
  MANUAL_BASELINE: "Nhập thủ công",
  NONE: "Chưa có dữ liệu",
} as const;

const componentRows: readonly Readonly<{
  key: ComponentField;
  label: string;
  subtract?: boolean;
  signed?: boolean;
}>[] = [
  { key: "proratedSalary", label: "Lương theo công" },
  { key: "dailyRevenueBonus", label: "Thưởng xu theo ngày" },
  { key: "monthlyRevenueBonus", label: "Thưởng xu tháng (dữ liệu cũ)" },
  { key: "attendanceBonus", label: "Thưởng chuyên cần" },
  { key: "achievementBonus", label: "Thưởng thành tích" },
  { key: "retainLevelBonus", label: "Thưởng giữ bậc" },
  { key: "jumpLevelBonus", label: "Thưởng nhảy bậc" },
  { key: "overtimePay", label: "Tiền tăng ca" },
  { key: "otherBonus", label: "Thưởng khác", signed: true },
  { key: "penalties", label: "Tiền phạt", subtract: true },
  { key: "advance", label: "Tạm ứng", subtract: true },
] as const;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: string | bigint | null): string {
  if (value === null) return "Chưa có";
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

function coins(value: string | bigint | null | undefined): string {
  if (value === null || value === undefined) return "Chưa có";
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} xu`;
}

function safeBigInt(value: string | undefined): bigint {
  return value && /^-?\d+$/.test(value) ? BigInt(value) : 0n;
}

function formatDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes >= 0 ? Math.trunc(minutes) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function formatOptionalDate(value: string | null): string {
  return value ? formatDate(value) : "Chưa cập nhật";
}

function machineCodeLabel(staff: PayrollPeriodDto["entries"][number]["staff"]): string {
  const codes = [
    ...new Set(
      staff.attendanceMachineCodeIntervals
        .map((interval) => interval.attendanceMachineCode)
        .filter((code): code is string => code !== null),
    ),
  ];
  if (codes.length === 0) return staff.attendanceMachineCode ?? "Chưa cập nhật";
  return codes.join(" → ");
}

function weekday(value: string): string {
  const date = new Date(`${value}T12:00:00+07:00`);
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function own(object: object | undefined, key: PropertyKey): boolean {
  return object ? Object.prototype.hasOwnProperty.call(object, key) : false;
}

function PayrollDurationInput({
  ariaLabel,
  className,
  disabled,
  minutes,
  onCommit,
}: Readonly<{
  ariaLabel: string;
  className: string;
  disabled: boolean;
  minutes: number;
  onCommit: (minutes: number) => void;
}>) {
  const formatted = formatDuration(minutes);
  const [draft, setDraft] = useState(formatted);
  const error = durationInputError(draft);

  function commit() {
    const parsed = parseDurationMinutes(draft);
    if (parsed === null) {
      setDraft(formatted);
      return;
    }
    setDraft(formatDuration(parsed));
    if (parsed !== minutes) onCommit(parsed);
  }

  return (
    <input
      aria-invalid={error ? "true" : undefined}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      inputMode="numeric"
      maxLength={5}
      onBlur={commit}
      onChange={(event) => {
        if (isDurationInputDraft(event.target.value)) setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(formatted);
          event.currentTarget.blur();
        }
      }}
      pattern="\d{1,2}:[0-5]\d"
      placeholder="HH:mm"
      title={error ?? "Nhập thời lượng HH:mm, ví dụ 02:30"}
      type="text"
      value={draft}
    />
  );
}

function dayOverride(
  values: PayrollWorksheetValues,
  businessDate: string,
): DayOverride | undefined {
  return values.days.find((day) => day.businessDate === businessDate);
}

function displayedDayValue(
  row: PayrollDailyRowDto,
  values: PayrollWorksheetValues,
  field: DayField,
): unknown {
  const local = dayOverride(values, row.businessDate);
  if (own(local, field)) return local?.[field];
  if (row.overriddenFields.includes(field)) return row.source[field];
  return row[field];
}

function roundRational(
  numerator: bigint,
  denominator: bigint,
  mode: "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEILING",
): bigint {
  if (denominator <= 0n || numerator < 0n) return 0n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "FLOOR") return quotient;
  if (mode === "CEILING") return quotient + 1n;
  const doubled = remainder * 2n;
  if (doubled > denominator) return quotient + 1n;
  if (doubled < denominator) return quotient;
  return mode === "HALF_UP" || quotient % 2n !== 0n ? quotient + 1n : quotient;
}

function roundMoney(
  numerator: bigint,
  denominator: bigint,
  unit: number,
  mode: "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEILING",
): bigint {
  const scale = BigInt(unit);
  return roundRational(numerator, denominator * scale, mode) * scale;
}

function decimalParts(values: readonly string[]): Readonly<{ numerator: bigint; scale: bigint }> {
  let scale = 1n;
  const parsed = values.map((value) => {
    const [, integer = "0", fraction = ""] = /^(\d+)(?:\.(\d+))?$/.exec(value) ?? [];
    const itemScale = 10n ** BigInt(fraction.length);
    if (itemScale > scale) scale = itemScale;
    return { numerator: BigInt(`${integer}${fraction}`), scale: itemScale };
  });
  return {
    numerator: parsed.reduce((total, item) => total + item.numerator * (scale / item.scale), 0n),
    scale,
  };
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
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const responseBody = await response.text();
  if (!contentType.includes("application/json")) {
    const error = new Error(
      response.status === 404
        ? "API Payroll chưa được nạp trên máy local. Hãy khởi động lại lệnh pnpm dev rồi tải lại trang."
        : `Máy chủ trả về phản hồi không hợp lệ (HTTP ${response.status}).`,
    );
    error.name = response.status === 409 ? "CONFLICT" : "API_ERROR";
    throw error;
  }
  let payload: {
    data?: T;
    error?: { message?: string };
  };
  try {
    payload = JSON.parse(responseBody) as typeof payload;
  } catch {
    const error = new Error(`API Payroll trả về JSON không hợp lệ (HTTP ${response.status}).`);
    error.name = "API_ERROR";
    throw error;
  }
  if (!response.ok || payload.data === undefined) {
    const error = new Error(payload.error?.message ?? "Không thể tải dữ liệu Payroll.");
    error.name = response.status === 409 ? "CONFLICT" : "API_ERROR";
    throw error;
  }
  return payload.data;
}

function CellShell({
  children,
  overridden,
  onReset,
}: Readonly<{ children: ReactNode; overridden: boolean; onReset: () => void }>) {
  return (
    <div className={`relative min-w-0 ${overridden ? "rounded bg-amber-50 p-0.5" : ""}`}>
      {children}
      {overridden ? (
        <button
          aria-label="Dùng lại giá trị tự tính"
          className="absolute -right-1 -top-2 z-10 rounded-full border border-amber-300 bg-white px-1 text-[10px] text-amber-800 shadow-sm"
          onClick={onReset}
          title="Dùng lại giá trị tự tính"
          type="button"
        >
          ↺
        </button>
      ) : null}
    </div>
  );
}

function fieldClass(overridden: boolean, width: string): string {
  return `${width} rounded border px-2 py-1.5 text-xs outline-none focus:border-sky-500 ${
    overridden ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"
  }`;
}

export function PayrollWorkspace({
  branches,
  canManagePayroll,
}: Readonly<{
  branches: readonly BranchOption[];
  canManagePayroll: boolean;
}>) {
  const [month, setMonth] = useState(currentMonth);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [period, setPeriod] = useState<PayrollPeriodDto | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState("ALL");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [worksheet, setWorksheet] = useState<PayrollWorksheetValues>(emptyWorksheet);
  const [standardDaysOff, setStandardDaysOff] = useState("");
  const [jobs, setJobs] = useState<readonly PayrollExportJobDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => period?.entries.find((entry) => entry.staff.id === selectedStaffId) ?? null,
    [period, selectedStaffId],
  );

  const filteredEntries = useMemo(() => {
    const query = employeeSearch.trim().toLocaleLowerCase("vi");
    if (!period || !query) return period?.entries ?? [];
    return period.entries.filter((entry) =>
      `${entry.staff.staffCode} ${machineCodeLabel(entry.staff)} ${entry.staff.fullName}`
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [employeeSearch, period]);

  const loadWorkspace = useCallback(
    async (forceCalculate = false) => {
      if (!month || (canManagePayroll && !branchId)) {
        setPeriod(null);
        return;
      }
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        if (!canManagePayroll) {
          const result = await api<readonly PayrollPeriodDto[]>(
            `/api/payroll/periods?month=${encodeURIComponent(month)}`,
          );
          setPeriod(result[0] ?? null);
          setSelectedStaffId(result[0]?.entries[0]?.staff.id ?? "ALL");
          return;
        }
        let result = await api<PayrollPeriodDto>("/api/payroll/periods/ensure", {
          method: "POST",
          body: JSON.stringify({
            branchId,
            month,
          }),
        });
        if (forceCalculate || result.entries.length === 0) {
          result = await api<PayrollPeriodDto>(`/api/payroll/periods/${result.id}/calculate`, {
            method: "POST",
            body: JSON.stringify({
              version: result.version,
            }),
          });
        }
        setPeriod(result);
        setSelectedStaffId((current) =>
          current === "ALL" || result.entries.some((entry) => entry.staff.id === current)
            ? current
            : "ALL",
        );
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Không thể mở kỳ lương.";
        setError(
          /salary rule|SALARY_RULES/i.test(message)
            ? "Chưa có Quy định lương áp dụng cho tháng này. Hãy vào menu Quy định → Quy định lương để thiết lập."
            : message,
        );
        try {
          const result = await api<readonly PayrollPeriodDto[]>(
            `/api/payroll/periods?branchId=${encodeURIComponent(branchId)}&month=${encodeURIComponent(month)}`,
          );
          setPeriod(result[0] ?? null);
        } catch {
          setPeriod(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [branchId, canManagePayroll, month],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedEntry) {
        setWorksheet(emptyWorksheet());
        return;
      }
      setWorksheet(selectedEntry.worksheetOverride?.values ?? emptyWorksheet());
      setStandardDaysOff(
        String(
          period?.standardDaysOff.overrideValue ??
            period?.standardDaysOff.appliedValue ??
            period?.standardDaysOff.ruleValue ??
            "",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [period, selectedEntry]);

  const loadJobs = useCallback(async (periodId: string) => {
    try {
      setJobs(
        await api<readonly PayrollExportJobDto[]>(`/api/payroll/periods/${periodId}/exports`),
      );
    } catch {
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    if (!period?.id) return;
    const timer = window.setTimeout(() => void loadJobs(period.id), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs, period?.id]);

  useEffect(() => {
    if (
      !period?.id ||
      !jobs.some((job) => job.status === "QUEUED" || job.status === "PROCESSING")
    ) {
      return;
    }
    const timer = window.setInterval(() => void loadJobs(period.id), 1_500);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs, period?.id]);

  function updateDay<K extends DayField>(
    businessDate: string,
    field: K,
    value: DayOverride[K] | undefined,
  ): void {
    setWorksheet((current) => {
      const existing = dayOverride(current, businessDate) ?? { businessDate };
      const mutable = { ...existing } as Record<string, unknown>;
      if (value === undefined) delete mutable[field];
      else mutable[field] = value;
      const next = mutable as DayOverride;
      const hasValues = Object.keys(next).some((key) => key !== "businessDate");
      return {
        ...current,
        days: [
          ...current.days.filter((day) => day.businessDate !== businessDate),
          ...(hasValues ? [next] : []),
        ].sort((left, right) => left.businessDate.localeCompare(right.businessDate)),
      };
    });
  }

  function updateComponent(field: ComponentField, value: string | undefined): void {
    setWorksheet((current) => {
      const components = { ...current.components };
      if (value === undefined) delete components[field];
      else components[field] = value;
      return { ...current, components };
    });
  }

  function updateTopLevel(
    field:
      | "baseSalaryAmount"
      | "previousMonthCoins"
      | "previousLevelCode"
      | "currentLevelCode"
      | "currentLevelName",
    value: string | null | undefined,
  ): void {
    setWorksheet((current) => {
      const next = { ...current } as Record<string, unknown>;
      if (value === undefined || (field === "baseSalaryAmount" && value === null)) {
        delete next[field];
      } else {
        next[field] = value;
      }
      return next as PayrollWorksheetValues;
    });
  }

  async function saveWorksheet(values = worksheet): Promise<void> {
    if (!period || !selectedEntry) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<PayrollPeriodDto>(`/api/payroll/periods/${period.id}/worksheet`, {
        method: "PUT",
        body: JSON.stringify({
          staffId: selectedEntry.staff.id,
          periodVersion: period.version,
          overrideVersion: selectedEntry.worksheetOverride?.version ?? null,
          standardDaysOffOverride: standardDaysOff.trim() === "" ? null : Number(standardDaysOff),
          values,
        }),
      });
      setPeriod(result);
      setSelectedStaffId(selectedEntry.staff.id);
      setNotice("Đã lưu và tính lại bảng lương.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể lưu bảng lương.";
      setError(
        caught instanceof Error && caught.name === "CONFLICT"
          ? `${message} Dữ liệu trên màn hình chưa bị mất; hãy tải lại trước khi lưu tiếp.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function syncAttendance(): Promise<void> {
    if (!period || !selectedEntry) {
      await loadWorkspace(true);
      return;
    }
    if (period.status === "LOCKED" || period.status === "PUBLISHED") {
      await saveWorksheet(worksheet);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<PayrollPeriodDto>(`/api/payroll/periods/${period.id}/calculate`, {
        method: "POST",
        body: JSON.stringify({
          version: period.version,
        }),
      });
      setPeriod(result);
      setNotice("Đã đồng bộ dữ liệu nguồn và giữ nguyên các ô đã chỉnh.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể đồng bộ dữ liệu nguồn.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPayslips(): Promise<void> {
    if (!period) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<PayrollPeriodDto>(`/api/payroll/periods/${period.id}/send`, {
        method: "POST",
        body: JSON.stringify({ version: period.version }),
      });
      setPeriod(result);
      setNotice("Đã gửi phiếu lương mới nhất cho nhân viên.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể gửi phiếu lương.");
    } finally {
      setBusy(false);
    }
  }

  async function requestExport(
    kind: "PAYSLIP_XLSX" | "PAYSLIP_PDF" | "BULK_ZIP",
    staffId?: string,
  ): Promise<void> {
    if (!period) return;
    setBusy(true);
    setError(null);
    try {
      await api<PayrollExportJobDto>(`/api/payroll/periods/${period.id}/exports`, {
        method: "POST",
        body: JSON.stringify({ kind, staffId: staffId ?? null }),
      });
      await loadJobs(period.id);
      setNotice("Đã đưa file vào hàng đợi xuất dữ liệu.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo file.");
    } finally {
      setBusy(false);
    }
  }

  function printPayroll(): void {
    if (!period || period.entries.length === 0) return;
    if (dirty) {
      setError("Bạn đang có thay đổi chưa lưu. Hãy lưu trước khi in bảng lương.");
      return;
    }
    const params = new URLSearchParams();
    if (selectedStaffId !== "ALL") params.set("staffId", selectedStaffId);
    const target = `/api/payroll/periods/${period.id}/print${
      params.size > 0 ? `?${params.toString()}` : ""
    }`;
    const opened = window.open(target, "_blank");
    if (!opened) {
      setError("Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.");
    } else {
      opened.opener = null;
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

  const editableRows = selectedEntry?.dailyRows ?? [];
  const workUnits = decimalParts(
    editableRows.map((row) => String(displayedDayValue(row, worksheet, "workUnits") ?? "0")),
  );
  const overtimeMinutes = editableRows.reduce(
    (total, row) => total + Number(displayedDayValue(row, worksheet, "overtimeMinutes") ?? 0),
    0,
  );
  const totalCoins = editableRows.reduce(
    (total, row) =>
      total + safeBigInt(String(displayedDayValue(row, worksheet, "revenueAmount") ?? "0")),
    0n,
  );
  const dailyBonusFromRows = editableRows.reduce(
    (total, row) =>
      total + safeBigInt(String(displayedDayValue(row, worksheet, "dailyRevenueBonus") ?? "0")),
    0n,
  );
  const penaltiesFromRows = editableRows.reduce(
    (total, row) =>
      total + safeBigInt(String(displayedDayValue(row, worksheet, "penalties") ?? "0")),
    0n,
  );

  function calculatedComponent(field: ComponentField): string {
    if (!selectedEntry || !period) return "0";
    if (field === "dailyRevenueBonus") return dailyBonusFromRows.toString();
    if (field === "penalties") return penaltiesFromRows.toString();
    if (field === "proratedSalary") return selectedEntry.calculatedComponents.proratedSalary;
    const policy = period.salaryPolicy;
    const payableDays =
      standardDaysOff.trim() === ""
        ? period.standardDaysOff.standardPayableDays
        : period.standardDaysOff.daysInMonth - Number(standardDaysOff);
    const baseSalary = safeBigInt(worksheet.baseSalaryAmount ?? selectedEntry.sourceBaseSalary);
    if (
      field === "overtimePay" &&
      payableDays &&
      payableDays > 0 &&
      policy.standardDailyMinutes &&
      policy.overtimeMultiplierBps !== null &&
      policy.roundingUnit &&
      policy.roundingMode &&
      policy.roundingApplyAt === "COMPONENT"
    ) {
      return roundMoney(
        baseSalary * BigInt(overtimeMinutes) * BigInt(policy.overtimeMultiplierBps),
        BigInt(payableDays) * BigInt(policy.standardDailyMinutes) * 10_000n,
        policy.roundingUnit,
        policy.roundingMode,
      ).toString();
    }
    return selectedEntry.calculatedComponents[field];
  }

  function effectiveComponent(field: ComponentField): string {
    return own(worksheet.components, field)
      ? (worksheet.components[field] ?? "0")
      : calculatedComponent(field);
  }

  const previewTotal = componentRows.reduce((total, row) => {
    const value = safeBigInt(effectiveComponent(row.key));
    return row.subtract ? total - value : total + value;
  }, 0n);

  const originalWorksheet = selectedEntry?.worksheetOverride?.values ?? emptyWorksheet();
  const dirty =
    selectedEntry !== null &&
    (JSON.stringify(worksheet) !== JSON.stringify(originalWorksheet) ||
      standardDaysOff !==
        String(
          period?.standardDaysOff.overrideValue ??
            period?.standardDaysOff.appliedValue ??
            period?.standardDaysOff.ruleValue ??
            "",
        ));

  return (
    <section className="mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Bảng chấm lương
          </p>
          <h2 className="mt-1 break-words text-xl font-semibold text-slate-950">
            {canManagePayroll ? "Kỳ lương theo tháng" : "Phiếu lương của tôi"}
          </h2>
          <p className="mt-1 break-words text-sm text-slate-600">
            Dữ liệu lấy từ Chấm công & Live; ô màu vàng là giá trị đã sửa riêng trong Payroll.
          </p>
        </div>
        {period ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800">
            {statusLabels[period.status]}
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid min-w-0 gap-3 lg:grid-cols-[180px_260px_minmax(280px,1fr)]">
        <label className="min-w-0 text-xs font-medium text-slate-700">
          1. Kỳ lương
          <input
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onChange={(event) => {
              setMonth(event.target.value);
              setSelectedStaffId("ALL");
            }}
            type="month"
            value={month}
          />
        </label>
        {canManagePayroll ? (
          <label className="min-w-0 text-xs font-medium text-slate-700">
            2. Cơ sở
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              disabled={!month}
              onChange={(event) => {
                setBranchId(event.target.value);
                setSelectedStaffId("ALL");
              }}
              value={branchId}
            >
              <option value="">Chọn cơ sở</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canManagePayroll ? (
          <label className="min-w-0 text-xs font-medium text-slate-700">
            3. Nhân viên
            <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row">
              <input
                aria-label="Tìm nhân viên Payroll"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Tìm theo tên, mã hồ sơ hoặc mã máy"
                value={employeeSearch}
              />
              <select
                aria-label="Chọn nhân viên Payroll"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                disabled={!period}
                onChange={(event) => setSelectedStaffId(event.target.value)}
                value={selectedStaffId}
              >
                <option value="ALL">Tất cả nhân viên</option>
                {filteredEntries.map((entry) => (
                  <option key={entry.staff.id} value={entry.staff.id}>
                    {entry.staff.fullName} · {entry.staff.staffCode} ·{" "}
                    {machineCodeLabel(entry.staff)}
                  </option>
                ))}
              </select>
            </div>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{error}</span>
          {/Quy định lương/.test(error) ? (
            <a className="font-semibold underline" href="/rules">
              Mở Quy định lương
            </a>
          ) : (
            <button
              className="font-semibold underline"
              onClick={() => void loadWorkspace()}
              type="button"
            >
              Tải lại
            </button>
          )}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 break-words rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 [overflow-wrap:anywhere]">
          {notice}
        </div>
      ) : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">Đang chuẩn bị bảng lương…</p> : null}

      {!loading && period && selectedStaffId === "ALL" ? (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              {period.branch.code} — {period.branch.name} · {period.entries.length} nhân viên
            </div>
            {canManagePayroll && period.entries.length > 0 ? (
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                  disabled={busy}
                  onClick={printPayroll}
                  type="button"
                >
                  In bảng lương
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void loadWorkspace(true)}
                  type="button"
                >
                  Đồng bộ từ chấm công
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void requestExport("BULK_ZIP")}
                  type="button"
                >
                  Xuất ZIP
                </button>
                <button
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || period.status === "PUBLISHED"}
                  onClick={() => void sendPayslips()}
                  type="button"
                >
                  Gửi phiếu lương
                </button>
              </div>
            ) : null}
          </div>
          <div className="max-h-[58vh] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[1080px] text-left text-sm">
              <thead className="sticky top-0 z-20 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="sticky left-0 z-30 bg-slate-100 px-3 py-3">Nhân viên</th>
                  <th className="px-3 py-3">Mã máy chấm công</th>
                  <th className="px-3 py-3">Lương cơ bản</th>
                  <th className="px-3 py-3">Ngày làm việc</th>
                  <th className="px-3 py-3">Tổng công</th>
                  <th className="px-3 py-3">Tổng xu</th>
                  <th className="px-3 py-3">Lương theo công</th>
                  <th className="px-3 py-3">Tổng thưởng</th>
                  <th className="px-3 py-3">Tổng phạt</th>
                  <th className="px-3 py-3">Tạm ứng</th>
                  <th className="px-3 py-3">Thực nhận</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {period.entries.map((entry) => {
                  const bonus =
                    safeBigInt(entry.dailyRevenueBonus) +
                    safeBigInt(entry.monthlyRevenueBonus) +
                    safeBigInt(entry.attendanceBonus) +
                    safeBigInt(entry.achievementBonus) +
                    safeBigInt(entry.levelBonus) +
                    safeBigInt(entry.overtimePay) +
                    safeBigInt(entry.otherBonus);
                  return (
                    <tr
                      className="cursor-pointer hover:bg-sky-50"
                      key={entry.id}
                      onClick={() => setSelectedStaffId(entry.staff.id)}
                    >
                      <td className="sticky left-0 bg-white px-3 py-3">
                        <div className="font-medium">{entry.staff.fullName}</div>
                        <div className="text-xs text-slate-500">{entry.staff.staffCode}</div>
                      </td>
                      <td
                        className="max-w-[180px] whitespace-normal px-3 py-3 [overflow-wrap:anywhere]"
                        title={machineCodeLabel(entry.staff)}
                      >
                        {machineCodeLabel(entry.staff)}
                      </td>
                      <td className="px-3 py-3">{money(entry.baseSalary)}</td>
                      <td className="px-3 py-3">{entry.workedDayCount} ngày</td>
                      <td className="px-3 py-3">{entry.workUnits}</td>
                      <td className="px-3 py-3">
                        {entry.currentMonthCoins === undefined
                          ? "Đã ẩn"
                          : coins(entry.currentMonthCoins)}
                      </td>
                      <td className="px-3 py-3">{money(entry.proratedSalary)}</td>
                      <td className="px-3 py-3 text-emerald-700">{money(bonus)}</td>
                      <td className="px-3 py-3 text-rose-700">{money(entry.penalties)}</td>
                      <td className="px-3 py-3">{money(entry.advance)}</td>
                      <td className="px-3 py-3 font-semibold">{money(entry.totalIncome)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && selectedEntry && period ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <div>
              <div className="font-semibold text-slate-950">
                {selectedEntry.staff.staffCode} — {selectedEntry.staff.fullName}
              </div>
              <div className="text-xs text-slate-500">
                {period.branch.name} · kỳ {period.month.slice(5, 7)}/{period.month.slice(0, 4)}
              </div>
              <div className="mt-1 text-xs font-medium text-slate-700">
                Mã máy chấm công: {machineCodeLabel(selectedEntry.staff)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManagePayroll ? (
                <>
                  <button
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void syncAttendance()}
                    type="button"
                  >
                    Đồng bộ từ chấm công
                  </button>
                  <button
                    className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={busy || !dirty}
                    onClick={() => void saveWorksheet()}
                    type="button"
                  >
                    {busy ? "Đang lưu…" : "Lưu thay đổi"}
                  </button>
                  <button
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={busy || dirty || period.status === "PUBLISHED"}
                    onClick={() => void sendPayslips()}
                    type="button"
                  >
                    Gửi phiếu lương
                  </button>
                </>
              ) : null}
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={printPayroll}
                type="button"
              >
                In phiếu lương
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={() => void requestExport("PAYSLIP_XLSX", selectedEntry.staff.id)}
                type="button"
              >
                XLSX
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={() => void requestExport("PAYSLIP_PDF", selectedEntry.staff.id)}
                type="button"
              >
                PDF
              </button>
            </div>
          </div>

          {canManagePayroll ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-[180px_230px]">
              <label className="text-xs font-medium text-slate-700">
                Ngày nghỉ chuẩn / tháng
                <input
                  className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${
                    period.standardDaysOff.overrideValue !== null
                      ? "border-amber-300 bg-amber-50"
                      : "border-slate-300"
                  }`}
                  max={30}
                  min={0}
                  onChange={(event) => setStandardDaysOff(event.target.value)}
                  type="number"
                  value={standardDaysOff}
                />
                <span className="mt-1 block font-normal text-slate-500">
                  Rule: {period.standardDaysOff.ruleValue ?? "chưa có"} · đang áp dụng:{" "}
                  {standardDaysOff || "chưa có"}
                </span>
              </label>
              <label className="text-xs font-medium text-slate-700">
                Số ngày công chuẩn
                <input
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm"
                  readOnly
                  value={
                    standardDaysOff === ""
                      ? (period.standardDaysOff.standardPayableDays ?? "")
                      : period.standardDaysOff.daysInMonth - Number(standardDaysOff)
                  }
                />
                <span className="mt-1 block font-normal text-slate-500">
                  {period.standardDaysOff.daysInMonth} ngày trong tháng − ngày nghỉ
                </span>
              </label>
            </div>
          ) : null}

          <div className="mt-4 max-h-[52vh] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[1830px] text-left text-xs">
              <thead className="sticky top-0 z-30 bg-slate-100 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="sticky left-0 z-40 w-[100px] bg-slate-100 px-2 py-3">Ngày</th>
                  <th className="sticky left-[100px] z-40 w-[72px] bg-slate-100 px-2 py-3">Thứ</th>
                  <th className="px-2 py-3">Check-in</th>
                  <th className="px-2 py-3">Check-out</th>
                  <th className="px-2 py-3">Thời lượng Live</th>
                  <th className="px-2 py-3">Thời lượng tăng ca</th>
                  <th className="px-2 py-3">Tổng công</th>
                  <th className="px-2 py-3">Doanh số (xu)</th>
                  <th className="px-2 py-3">Mốc xu</th>
                  <th className="px-2 py-3">Tiền thưởng</th>
                  <th className="px-2 py-3">Phân loại lỗi</th>
                  <th className="px-2 py-3">Chi tiết lỗi</th>
                  <th className="px-2 py-3">Tiền phạt</th>
                  <th className="px-2 py-3">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {editableRows.map((row) => {
                  const local = dayOverride(worksheet, row.businessDate);
                  const value = (field: DayField) => displayedDayValue(row, worksheet, field);
                  const reset = (field: DayField) => updateDay(row.businessDate, field, undefined);
                  const isOverridden = (field: DayField) => own(local, field);
                  return (
                    <tr className="align-top" key={row.businessDate}>
                      <td className="sticky left-0 z-20 w-[100px] bg-white px-2 py-2 font-semibold">
                        {formatDate(row.businessDate)}
                      </td>
                      <td className="sticky left-[100px] z-20 w-[72px] bg-white px-2 py-2">
                        {weekday(row.businessDate)}
                      </td>
                      {(["checkInTime", "checkOutTime"] as const).map((field) => (
                        <td className="px-2 py-2" key={field}>
                          <CellShell onReset={() => reset(field)} overridden={isOverridden(field)}>
                            <input
                              className={fieldClass(isOverridden(field), "w-[94px]")}
                              disabled={!canManagePayroll}
                              onChange={(event) =>
                                updateDay(
                                  row.businessDate,
                                  field,
                                  event.target.value === "" ? null : event.target.value,
                                )
                              }
                              type="time"
                              value={String(value(field) ?? "")}
                            />
                          </CellShell>
                        </td>
                      ))}
                      {(["actualLiveMinutes", "overtimeMinutes"] as const).map((field) => (
                        <td className="px-2 py-2" key={field}>
                          <CellShell onReset={() => reset(field)} overridden={isOverridden(field)}>
                            <PayrollDurationInput
                              ariaLabel={`${field === "actualLiveMinutes" ? "Thời lượng Live" : "Thời lượng tăng ca"} ${row.businessDate}`}
                              className={fieldClass(isOverridden(field), "w-[82px]")}
                              disabled={!canManagePayroll}
                              key={`${selectedEntry.staff.id}:${row.businessDate}:${field}:${String(value(field) ?? 0)}`}
                              minutes={Number(value(field) ?? 0)}
                              onCommit={(minutes) => updateDay(row.businessDate, field, minutes)}
                            />
                          </CellShell>
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <CellShell
                          onReset={() => reset("workUnits")}
                          overridden={isOverridden("workUnits")}
                        >
                          <input
                            className={fieldClass(isOverridden("workUnits"), "w-[76px]")}
                            disabled={!canManagePayroll}
                            min={0}
                            onChange={(event) =>
                              updateDay(row.businessDate, "workUnits", event.target.value)
                            }
                            step="0.5"
                            type="number"
                            value={String(value("workUnits") ?? "0")}
                          />
                        </CellShell>
                      </td>
                      {(
                        ["revenueAmount", "rewardThresholdAmount", "dailyRevenueBonus"] as const
                      ).map((field) => (
                        <td className="px-2 py-2" key={field}>
                          <CellShell onReset={() => reset(field)} overridden={isOverridden(field)}>
                            <input
                              className={fieldClass(isOverridden(field), "w-[112px]")}
                              disabled={!canManagePayroll}
                              min={0}
                              onChange={(event) =>
                                updateDay(
                                  row.businessDate,
                                  field,
                                  field === "rewardThresholdAmount" && event.target.value === ""
                                    ? null
                                    : event.target.value,
                                )
                              }
                              type="number"
                              value={String(value(field) ?? "")}
                            />
                          </CellShell>
                        </td>
                      ))}
                      {(["violationCategory", "violationDetail"] as const).map((field) => (
                        <td className="px-2 py-2" key={field}>
                          <CellShell onReset={() => reset(field)} overridden={isOverridden(field)}>
                            <input
                              className={fieldClass(isOverridden(field), "w-[170px]")}
                              disabled={!canManagePayroll}
                              onChange={(event) =>
                                updateDay(
                                  row.businessDate,
                                  field,
                                  event.target.value === "" ? null : event.target.value,
                                )
                              }
                              value={String(value(field) ?? "")}
                            />
                          </CellShell>
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <CellShell
                          onReset={() => reset("penalties")}
                          overridden={isOverridden("penalties")}
                        >
                          <input
                            className={fieldClass(isOverridden("penalties"), "w-[112px]")}
                            disabled={!canManagePayroll}
                            min={0}
                            onChange={(event) =>
                              updateDay(row.businessDate, "penalties", event.target.value)
                            }
                            type="number"
                            value={String(value("penalties") ?? "0")}
                          />
                        </CellShell>
                      </td>
                      <td className="px-2 py-2">
                        <CellShell onReset={() => reset("note")} overridden={isOverridden("note")}>
                          <input
                            className={fieldClass(isOverridden("note"), "w-[190px]")}
                            disabled={!canManagePayroll}
                            onChange={(event) =>
                              updateDay(
                                row.businessDate,
                                "note",
                                event.target.value === "" ? null : event.target.value,
                              )
                            }
                            value={String(value("note") ?? "")}
                          />
                        </CellShell>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-sky-100 font-semibold text-slate-900">
                <tr>
                  <td className="sticky left-0 z-30 bg-sky-100 px-2 py-3" colSpan={2}>
                    TỔNG
                  </td>
                  <td className="px-2 py-3" colSpan={2} />
                  <td className="px-2 py-3">
                    {formatDuration(
                      editableRows.reduce(
                        (total, row) =>
                          total +
                          Number(displayedDayValue(row, worksheet, "actualLiveMinutes") ?? 0),
                        0,
                      ),
                    )}
                  </td>
                  <td className="px-2 py-3">{formatDuration(overtimeMinutes)}</td>
                  <td className="px-2 py-3">
                    {(Number(workUnits.numerator) / Number(workUnits.scale)).toLocaleString(
                      "vi-VN",
                    )}
                  </td>
                  <td className="px-2 py-3">{coins(totalCoins)}</td>
                  <td />
                  <td className="px-2 py-3">{money(dailyBonusFromRows)}</td>
                  <td colSpan={2} />
                  <td className="px-2 py-3 text-rose-700">{money(penaltiesFromRows)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
            <div className="bg-violet-100 px-4 py-2 text-center text-sm font-bold">
              CƠ SỞ TÍNH LƯƠNG THỬ VIỆC / CHÍNH THỨC
            </div>
            <div className="grid gap-px bg-slate-200 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div className="bg-white px-3 py-3">
                <p className="text-xs text-slate-500">Ngày gia nhập</p>
                <p className="font-semibold">
                  {formatOptionalDate(selectedEntry.employmentSalary.joinedDate)}
                </p>
              </div>
              <div className="bg-white px-3 py-3">
                <p className="text-xs text-slate-500">Ngày lên chính thức</p>
                <p className="font-semibold">
                  {formatOptionalDate(selectedEntry.employmentSalary.officialDate)}
                </p>
              </div>
              <div className="bg-white px-3 py-3">
                <p className="text-xs text-slate-500">
                  Công thử việc ·{" "}
                  {new Intl.NumberFormat("vi-VN", {
                    maximumFractionDigits: 2,
                  }).format(selectedEntry.employmentSalary.probationSalaryRateBps / 100)}
                  %
                </p>
                <p className="font-semibold">
                  {selectedEntry.employmentSalary.probationWorkUnits} công ·{" "}
                  {money(selectedEntry.employmentSalary.probationSalaryAmount)}
                </p>
              </div>
              <div className="bg-white px-3 py-3">
                <p className="text-xs text-slate-500">Công chính thức · 100%</p>
                <p className="font-semibold">
                  {selectedEntry.employmentSalary.officialWorkUnits} công ·{" "}
                  {money(selectedEntry.employmentSalary.officialSalaryAmount)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-violet-50 px-4 py-3 text-sm">
              <span>
                Hệ thống tính:{" "}
                <strong>{money(selectedEntry.employmentSalary.calculatedProratedSalary)}</strong>
              </span>
              {selectedEntry.employmentSalary.excludedBeforeJoinWorkUnits !== "0" ? (
                <span className="font-medium text-amber-800">
                  Có {selectedEntry.employmentSalary.excludedBeforeJoinWorkUnits} công trước ngày
                  gia nhập không được tính vào lương cứng.
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(480px,1.2fr)]">
            <div className="rounded-xl border border-slate-200">
              <div className="rounded-t-xl bg-sky-100 px-4 py-2 text-center text-sm font-bold">
                A. TĂNG TRƯỞNG BẬC
              </div>
              <div className="grid grid-cols-[1fr_180px] gap-px bg-slate-200 text-sm">
                <div className="bg-white px-3 py-2">Tổng xu tháng trước</div>
                <div className="bg-white px-3 py-2 text-right font-semibold">
                  {selectedEntry.monthlyLevel.previousMonthCoinsSource === "NONE" ||
                  selectedEntry.monthlyLevel.previousMonthCoinsSource === "MANUAL_BASELINE" ? (
                    <CellShell
                      onReset={() => updateTopLevel("previousMonthCoins", undefined)}
                      overridden={own(worksheet, "previousMonthCoins")}
                    >
                      <div className="flex items-center gap-1">
                        <input
                          aria-label="Tổng xu tháng trước nhập thủ công"
                          className={fieldClass(
                            own(worksheet, "previousMonthCoins"),
                            "h-full min-w-0 flex-1 text-right",
                          )}
                          disabled={!canManagePayroll}
                          min={0}
                          onChange={(event) =>
                            updateTopLevel(
                              "previousMonthCoins",
                              event.target.value === "" ? null : event.target.value,
                            )
                          }
                          placeholder="Nhập số xu"
                          type="number"
                          value={
                            own(worksheet, "previousMonthCoins")
                              ? (worksheet.previousMonthCoins ?? "")
                              : (selectedEntry.monthlyLevel.previousMonthCoins ?? "")
                          }
                        />
                        <span className="text-xs text-slate-500">xu</span>
                      </div>
                    </CellShell>
                  ) : (
                    coins(selectedEntry.monthlyLevel.previousMonthCoins)
                  )}
                </div>
                <div className="bg-white px-3 py-2">Nguồn tháng trước</div>
                <div className="bg-white px-3 py-2 text-right text-xs">
                  {previousCoinSourceLabels[selectedEntry.monthlyLevel.previousMonthCoinsSource]}
                </div>
                <div className="bg-white px-3 py-2">Bậc tháng trước</div>
                <div className="bg-white px-3 py-2 text-right font-semibold">
                  {selectedEntry.monthlyLevel.previousLevelName ??
                    selectedEntry.monthlyLevel.previousLevelCode ??
                    "Chưa có"}
                </div>
                <div className="bg-white px-3 py-2">Tổng xu tháng này</div>
                <div className="bg-white px-3 py-2 text-right font-semibold text-sky-700">
                  {coins(selectedEntry.monthlyLevel.currentMonthCoins)}
                </div>
                <div className="bg-white px-3 py-2">Bậc tháng này</div>
                <div className="bg-white px-3 py-2 text-right font-semibold">
                  {selectedEntry.monthlyLevel.currentLevelName ??
                    selectedEntry.monthlyLevel.currentLevelCode ??
                    "Chưa đạt bậc"}
                </div>
                <div className="bg-white px-3 py-2">Ngày làm việc / điều kiện</div>
                <div className="bg-white px-3 py-2 text-right">
                  <span
                    className={
                      selectedEntry.monthlyLevel.attendanceEligible
                        ? "font-semibold text-emerald-700"
                        : "text-slate-700"
                    }
                  >
                    {selectedEntry.monthlyLevel.workedDayCount}/
                    {selectedEntry.monthlyLevel.attendanceRequiredDays ?? "—"} ngày
                  </span>
                </div>
                <div className="bg-white px-3 py-2">Trạng thái</div>
                <div className="bg-white px-3 py-2 text-right font-semibold">
                  {transitionLabels[selectedEntry.monthlyLevel.transition]}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="bg-emerald-100 px-4 py-2 text-center text-sm font-bold">
                B. CÁC KHOẢN THU NHẬP / KHẤU TRỪ
              </div>
              <div className="grid grid-cols-[minmax(220px,1fr)_180px] gap-px bg-slate-200 text-sm">
                <div className="bg-white px-3 py-2 font-semibold">Lương cơ bản</div>
                <CellShell
                  onReset={() => updateTopLevel("baseSalaryAmount", undefined)}
                  overridden={own(worksheet, "baseSalaryAmount")}
                >
                  <input
                    aria-label="Lương cơ bản áp dụng"
                    className={fieldClass(own(worksheet, "baseSalaryAmount"), "h-full w-full")}
                    disabled={!canManagePayroll}
                    min={0}
                    onChange={(event) => updateTopLevel("baseSalaryAmount", event.target.value)}
                    type="number"
                    value={worksheet.baseSalaryAmount ?? selectedEntry.sourceBaseSalary}
                  />
                </CellShell>
                {componentRows.map((row) => {
                  const overridden = own(worksheet.components, row.key);
                  const calculated = calculatedComponent(row.key);
                  return (
                    <div className="contents" key={row.key}>
                      <div className={`bg-white px-3 py-2 ${row.subtract ? "text-rose-700" : ""}`}>
                        {row.label}
                        <span className="ml-2 text-xs text-slate-400">
                          Tự tính {money(calculated)}
                        </span>
                      </div>
                      <CellShell
                        onReset={() => updateComponent(row.key, undefined)}
                        overridden={overridden}
                      >
                        <input
                          className={fieldClass(overridden, "h-full w-full text-right")}
                          disabled={!canManagePayroll}
                          min={row.signed ? undefined : 0}
                          onChange={(event) => updateComponent(row.key, event.target.value)}
                          type="number"
                          value={effectiveComponent(row.key)}
                        />
                      </CellShell>
                    </div>
                  );
                })}
                <div className="bg-sky-100 px-3 py-3 font-bold uppercase">Tổng thu nhập</div>
                <div className="bg-sky-100 px-3 py-3 text-right font-bold">
                  {money(previewTotal)}
                </div>
              </div>
            </div>
          </div>

          {dirty ? (
            <div className="sticky bottom-3 z-40 mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-lg">
              <span className="text-sm font-medium text-amber-900">
                Có thay đổi chưa lưu. Ô màu vàng là giá trị đang ghi đè.
              </span>
              {canManagePayroll ? (
                <button
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void saveWorksheet()}
                  type="button"
                >
                  Lưu thay đổi
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && !period && !error ? (
        <div className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
          {canManagePayroll
            ? "Chọn kỳ lương và cơ sở để hệ thống tự mở bảng lương."
            : "Chưa có phiếu lương đã gửi trong kỳ này."}
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-3">
          <div className="text-sm font-semibold">File xuất gần đây</div>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {jobs.map((job) => (
              <li className="flex items-center justify-between gap-3 py-2" key={job.id}>
                <span>
                  {job.kind} · {job.status} · {job.progress}%
                </span>
                {job.status === "COMPLETED" ? (
                  <button
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white"
                    onClick={() => void download(job.id)}
                    type="button"
                  >
                    Tải file
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
