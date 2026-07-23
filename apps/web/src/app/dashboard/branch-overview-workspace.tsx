"use client";

import type {
  AttendanceRecordDto,
  BranchMonthlyOverviewDto,
  BranchOverviewCellResultDto,
  BranchOverviewDayDto,
  BranchOverviewRowDto,
} from "@ald/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@ald/ui";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

type BranchOption = Readonly<{
  id: string;
  code: string;
  name: string;
}>;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
type EditableMetric = "revenueAmount" | "actualLiveMinutes";

type EditableDay = BranchOverviewDayDto & {
  saveState: SaveState;
  message: string | null;
  dirtyRevenue: boolean;
  dirtyLive: boolean;
};

type EditableRow = Omit<BranchOverviewRowDto, "days"> & {
  days: readonly EditableDay[];
};

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

const IDENTITY_WIDTH = 470;
const DAY_WIDTH = 190;
const TOTAL_WIDTH = 470;
const weekdayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

const employmentCategoryLabels = {
  OFFICIAL: "Chính thức",
  PROBATION: "Thử việc",
  CONTRACTOR: "Hợp đồng",
  INTERN: "Thực tập",
} as const;

const employmentStatusLabels = {
  ACTIVE: "Đang làm",
  ON_LEAVE: "Tạm nghỉ",
  TERMINATED: "Đã nghỉ",
} as const;

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}`;
}

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}g ${rest.toString().padStart(2, "0")}p` : `${rest}p`;
}

function payloadError(payload: ApiPayload): string {
  return typeof payload.error?.message === "string"
    ? payload.error.message
    : "Không thể tải bảng tổng quan.";
}

function editableRows(rows: readonly BranchOverviewRowDto[]): readonly EditableRow[] {
  return rows.map((row) => ({
    ...row,
    days: row.days.map((day) => ({
      ...day,
      saveState: "idle",
      message: null,
      dirtyRevenue: false,
      dirtyLive: false,
    })),
  }));
}

function rowTotals(days: readonly EditableDay[]) {
  let revenue = 0n;
  let workUnits = 0;
  let live = 0;
  let overtime = 0;
  let penalties = 0n;
  for (const day of days) {
    revenue += BigInt(day.revenueAmount);
    workUnits += Number(day.workUnits);
    live += day.actualLiveMinutes;
    overtime += day.overtimeMinutes;
    penalties += BigInt(day.penaltyAmount);
  }
  return {
    revenueAmount: revenue.toString(),
    workUnits: workUnits.toFixed(2).replace(/\.?0+$/, ""),
    actualLiveMinutes: live,
    overtimeMinutes: overtime,
    penaltyAmount: penalties.toString(),
  };
}

function queryString(input: {
  branchId: string;
  month: string;
  employmentStatus: string;
  employmentCategory: string;
  levelId: string;
  search: string;
}) {
  const params = new URLSearchParams({
    branchId: input.branchId,
    month: input.month,
  });
  if (input.employmentStatus) params.set("employmentStatus", input.employmentStatus);
  if (input.employmentCategory) params.set("employmentCategory", input.employmentCategory);
  if (input.levelId) params.set("levelId", input.levelId);
  if (input.search) params.set("search", input.search);
  return params.toString();
}

function cellId(staffId: string, businessDate: string, metric: 0 | 1) {
  return `overview-${staffId}-${businessDate}-${metric}`;
}

export function BranchOverviewWorkspace({
  branches,
  isGeneralManager,
}: Readonly<{
  branches: readonly BranchOption[];
  isGeneralManager: boolean;
}>) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [month, setMonth] = useState(currentMonth);
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [employmentCategory, setEmploymentCategory] = useState("");
  const [levelId, setLevelId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [reason, setReason] = useState("");
  const [dataset, setDataset] = useState<BranchMonthlyOverviewDto | null>(null);
  const [rows, setRows] = useState<readonly EditableRow[]>([]);
  const [loading, setLoading] = useState(branches.length > 0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rowsRef = useRef(rows);
  const reasonRef = useRef(reason);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const loadSequence = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    reasonRef.current = reason;
  }, [reason]);

  const calendar = dataset?.calendar ?? [];
  // TanStack Virtual intentionally exposes imperative functions for scroll coordination.
  // eslint-disable-next-line react-hooks/incompatible-library
  const dayVirtualizer = useVirtualizer({
    count: calendar.length,
    horizontal: true,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DAY_WIDTH,
    overscan: 3,
    paddingStart: IDENTITY_WIDTH,
    paddingEnd: TOTAL_WIDTH,
  });

  const load = useCallback(async () => {
    if (!branchId) return;
    const sequence = ++loadSequence.current;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setLoading(true);
    setPermissionDenied(false);
    setMessage(null);
    try {
      const query = queryString({
        branchId,
        month,
        employmentStatus,
        employmentCategory,
        levelId,
        search: deferredSearch,
      });
      const response = await fetch(`/api/branch-overview?${query}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiPayload;
      if (sequence !== loadSequence.current) return;
      if (!response.ok) {
        setDataset(null);
        setRows([]);
        setPermissionDenied(response.status === 403 || response.status === 404);
        setMessage(payloadError(payload));
        return;
      }
      const overview = payload.data as BranchMonthlyOverviewDto;
      setDataset(overview);
      setRows(editableRows(overview.rows));
    } catch {
      if (sequence !== loadSequence.current) return;
      setDataset(null);
      setRows([]);
      setMessage("Mất kết nối khi tải bảng tổng quan.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [branchId, deferredSearch, employmentCategory, employmentStatus, levelId, month]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  function replaceDay(
    staffId: string,
    businessDate: string,
    updater: (day: EditableDay) => EditableDay,
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row.staff.id !== staffId) return row;
        const days = row.days.map((day) =>
          day.businessDate === businessDate ? updater(day) : day,
        );
        return { ...row, days, totals: rowTotals(days) };
      }),
    );
  }

  function updateMetric(
    staffId: string,
    businessDate: string,
    metric: EditableMetric,
    rawValue: string,
  ) {
    if (!/^\d*$/.test(rawValue)) return;
    const value = rawValue || "0";
    if (metric === "actualLiveMinutes" && Number(value) > 2_880) return;
    replaceDay(staffId, businessDate, (day) => ({
      ...day,
      [metric]: metric === "revenueAmount" ? value : Number(value),
      dirtyRevenue: day.dirtyRevenue || metric === "revenueAmount",
      dirtyLive: day.dirtyLive || metric === "actualLiveMinutes",
      saveState: "dirty",
      message: null,
    }));
    scheduleSave(staffId, businessDate);
  }

  function scheduleSave(staffId: string, businessDate: string) {
    const key = `${staffId}:${businessDate}`;
    const current = timers.current.get(key);
    if (current) clearTimeout(current);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        const row = rowsRef.current.find((candidate) => candidate.staff.id === staffId);
        const day = row?.days.find((candidate) => candidate.businessDate === businessDate);
        if (!day || day.saveState !== "dirty") return;
        void saveEdits([
          {
            clientId: key,
            staffId,
            businessDate,
            version: day.version,
            ...(day.dirtyRevenue ? { revenueAmount: day.revenueAmount } : {}),
            ...(day.dirtyLive ? { actualLiveMinutes: day.actualLiveMinutes } : {}),
          },
        ]);
      }, 650),
    );
  }

  async function saveEdits(
    edits: readonly Readonly<{
      clientId: string;
      staffId: string;
      businessDate: string;
      version: number | null;
      revenueAmount?: string;
      actualLiveMinutes?: number;
    }>[],
  ) {
    const auditReason = reasonRef.current.trim();
    if (!auditReason) {
      setMessage("Nhập lý do trước khi lưu dữ liệu.");
      for (const edit of edits) {
        replaceDay(edit.staffId, edit.businessDate, (day) => ({
          ...day,
          saveState: "error",
          message: "Nhập lý do trước khi lưu.",
        }));
      }
      return;
    }
    for (const edit of edits) {
      replaceDay(edit.staffId, edit.businessDate, (day) => ({
        ...day,
        saveState: "saving",
        message: null,
      }));
    }
    try {
      const response = await fetch("/api/branch-overview", {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          reason: auditReason,
          edits,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        for (const edit of edits) {
          replaceDay(edit.staffId, edit.businessDate, (day) => ({
            ...day,
            saveState: response.status === 409 ? "conflict" : "error",
            message: payloadError(payload),
          }));
        }
        return;
      }
      const results = payload.data as readonly BranchOverviewCellResultDto[];
      const editByClientId = new Map(edits.map((edit) => [edit.clientId, edit]));
      const savedCount = results.filter((result) => result.status === "SAVED").length;
      if (edits.length > 1) {
        setMessage(
          savedCount === results.length
            ? `Đã lưu ${savedCount} ngày từ vùng paste.`
            : `Đã lưu ${savedCount}/${results.length} ngày; kiểm tra các ô báo lỗi.`,
        );
      }
      for (const result of results) {
        const edit = editByClientId.get(result.clientId);
        if (!edit) continue;
        replaceDay(edit.staffId, edit.businessDate, (day) =>
          result.status === "SAVED" && result.attendance
            ? savedDay(day, result.attendance)
            : {
                ...day,
                saveState: result.status === "CONFLICT" ? "conflict" : "error",
                message: result.message,
              },
        );
      }
    } catch {
      for (const edit of edits) {
        replaceDay(edit.staffId, edit.businessDate, (day) => ({
          ...day,
          saveState: "error",
          message: "Mất kết nối khi lưu dữ liệu.",
        }));
      }
    }
  }

  function pasteCells(
    event: ClipboardEvent<HTMLInputElement>,
    startRow: number,
    startDay: number,
    startMetric: 0 | 1,
  ) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    const matrix = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
      .map((line) => line.split("\t"));
    const grouped = new Map<
      string,
      {
        clientId: string;
        staffId: string;
        businessDate: string;
        version: number | null;
        revenueAmount?: string;
        actualLiveMinutes?: number;
      }
    >();
    const localChanges: Array<{
      staffId: string;
      businessDate: string;
      metric: EditableMetric;
      value: string;
    }> = [];

    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
      const targetRow = rowsRef.current[startRow + rowOffset];
      if (!targetRow) {
        setMessage("Vùng paste vượt quá số nhân viên đang hiển thị.");
        return;
      }
      const clipboardRow = matrix[rowOffset]!;
      for (let columnOffset = 0; columnOffset < clipboardRow.length; columnOffset += 1) {
        const flatColumn = startDay * 2 + startMetric + columnOffset;
        const dayIndex = Math.floor(flatColumn / 2);
        const metric: EditableMetric = flatColumn % 2 === 0 ? "revenueAmount" : "actualLiveMinutes";
        const targetDay = targetRow.days[dayIndex];
        const value = clipboardRow[columnOffset]!.trim();
        if (!targetDay) {
          setMessage("Vùng paste vượt quá số ngày trong tháng.");
          return;
        }
        if (targetDay.archivedAt) {
          setMessage(`Không thể paste vào attendance đã lưu trữ ngày ${targetDay.businessDate}.`);
          return;
        }
        if (!/^\d+$/.test(value)) {
          setMessage(
            `Ô ${targetDay.businessDate} của ${targetRow.staff.fullName} phải là số nguyên không âm.`,
          );
          return;
        }
        if (metric === "actualLiveMinutes" && Number(value) > 2_880) {
          setMessage("Live thực tế không được vượt quá 2.880 phút.");
          return;
        }
        const key = `${targetRow.staff.id}:${targetDay.businessDate}`;
        const edit = grouped.get(key) ?? {
          clientId: key,
          staffId: targetRow.staff.id,
          businessDate: targetDay.businessDate,
          version: targetDay.version,
        };
        if (metric === "revenueAmount") edit.revenueAmount = value;
        else edit.actualLiveMinutes = Number(value);
        grouped.set(key, edit);
        localChanges.push({
          staffId: targetRow.staff.id,
          businessDate: targetDay.businessDate,
          metric,
          value,
        });
      }
    }
    if (grouped.size > 200) {
      setMessage("Mỗi lần paste tối đa 200 ngày nhân viên; hãy chia vùng dữ liệu nhỏ hơn.");
      return;
    }
    for (const key of grouped.keys()) {
      const pending = timers.current.get(key);
      if (pending) clearTimeout(pending);
      timers.current.delete(key);
    }
    for (const change of localChanges) {
      replaceDay(change.staffId, change.businessDate, (day) => ({
        ...day,
        [change.metric]: change.metric === "revenueAmount" ? change.value : Number(change.value),
        dirtyRevenue: day.dirtyRevenue || change.metric === "revenueAmount",
        dirtyLive: day.dirtyLive || change.metric === "actualLiveMinutes",
        saveState: "dirty",
        message: null,
      }));
    }
    setMessage(`Đang lưu ${localChanges.length} ô đã paste…`);
    void saveEdits([...grouped.values()]);
  }

  function moveFocus(
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    dayIndex: number,
    metric: 0 | 1,
  ) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const rowDelta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const columnDelta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const nextRowIndex = rowIndex + rowDelta;
    const nextFlatColumn = dayIndex * 2 + metric + columnDelta;
    const nextDayIndex = Math.floor(nextFlatColumn / 2);
    const nextMetric = (nextFlatColumn % 2) as 0 | 1;
    const nextRow = rowsRef.current[nextRowIndex];
    const nextDay = nextRow?.days[nextDayIndex];
    if (!nextRow || !nextDay || nextMetric < 0) return;
    event.preventDefault();
    dayVirtualizer.scrollToIndex(nextDayIndex, { align: "auto" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(cellId(nextRow.staff.id, nextDay.businessDate, nextMetric))
          ?.focus();
      });
    });
  }

  const exportQuery = queryString({
    branchId,
    month,
    employmentStatus,
    employmentCategory,
    levelId,
    search: deferredSearch,
  });
  const virtualDays = dayVirtualizer.getVirtualItems();
  const visibleTotals = rowTotals(rows.flatMap((row) => row.days));
  const chartData = rows.map((row) => ({
    name: row.staff.streamingAlias || row.staff.fullName,
    revenueMillions: Number(BigInt(row.totals.revenueAmount) / 10_000n) / 100,
  }));

  if (branches.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Tổng quan cơ sở</h2>
        <p className="mt-3 text-sm text-slate-500">Chưa có cơ sở trong phạm vi truy cập.</p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Bảng tổng quan cơ sở</h2>
          <p className="mt-1 text-sm text-slate-500">
            Projection trực tiếp từ attendance · revenue và Live theo ngày
          </p>
        </div>
        <a
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
          href={`/api/exports/branch-monthly-overview?${exportQuery}`}
        >
          Xuất XLSX
        </a>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="grid gap-1 text-sm">
          Cơ sở
          <select
            aria-label="Cơ sở tổng quan"
            disabled={!isGeneralManager && branches.length === 1}
            onChange={(event) => setBranchId(event.target.value)}
            value={branchId}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tháng
          <input
            aria-label="Tháng tổng quan cơ sở"
            onChange={(event) => setMonth(event.target.value)}
            type="month"
            value={month}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Trạng thái
          <select
            aria-label="Lọc trạng thái nhân viên"
            onChange={(event) => setEmploymentStatus(event.target.value)}
            value={employmentStatus}
          >
            <option value="">Tất cả</option>
            {Object.entries(employmentStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Loại nhân sự
          <select
            aria-label="Lọc loại nhân sự"
            onChange={(event) => setEmploymentCategory(event.target.value)}
            value={employmentCategory}
          >
            <option value="">Tất cả</option>
            {Object.entries(employmentCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Cấp bậc
          <select
            aria-label="Lọc cấp bậc"
            onChange={(event) => setLevelId(event.target.value)}
            value={levelId}
          >
            <option value="">Tất cả</option>
            {dataset?.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.code} — {level.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tìm nhân viên
          <input
            aria-label="Tìm nhân viên tổng quan"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tên, mã, alias"
            value={search}
          />
        </label>
      </div>
      <label className="mt-3 grid max-w-xl gap-1 text-sm">
        Lý do chỉnh sửa
        <input
          aria-label="Lý do chỉnh sửa tổng quan"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Bắt buộc khi inline edit hoặc paste"
          value={reason}
        />
      </label>

      {message ? (
        <p aria-live="polite" className="mt-3 text-sm text-slate-600">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center">
          Đang tổng hợp dữ liệu nguồn…
        </div>
      ) : permissionDenied ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          Bạn không có quyền xem cơ sở này.
        </div>
      ) : !dataset ? (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          {message ?? "Không thể tải dữ liệu."}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Doanh số cơ sở" value={`${money(visibleTotals.revenueAmount)} ₫`} />
            <SummaryCard label="Tổng công" value={visibleTotals.workUnits} />
            <SummaryCard label="Tổng Live" value={duration(visibleTotals.actualLiveMinutes)} />
            <SummaryCard label="Tăng ca" value={duration(visibleTotals.overtimeMinutes)} />
            <SummaryCard label="Tiền phạt" value={`${money(visibleTotals.penaltyAmount)} ₫`} />
          </div>

          {rows.length === 0 ? (
            <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-slate-500">
              Không có nhân viên phù hợp bộ lọc.
            </div>
          ) : (
            <>
              <div className="mt-6 hidden lg:block">
                <p className="mb-2 text-xs text-slate-500">
                  Có thể paste vùng TSV từ Excel; toàn bộ vùng được validate trước khi lưu.
                </p>
                <div
                  className="max-h-[68vh] overflow-auto rounded-xl border border-slate-200"
                  ref={scrollRef}
                >
                  <div className="relative" style={{ width: dayVirtualizer.getTotalSize() }}>
                    <div className="sticky top-0 z-40 h-20 border-b border-slate-300 bg-slate-100">
                      <IdentityHeader />
                      {virtualDays.map((virtualDay) => {
                        const day = calendar[virtualDay.index]!;
                        return (
                          <div
                            className="absolute top-0 h-20 border-r border-slate-300 bg-sky-50"
                            key={day.businessDate}
                            style={{
                              left: virtualDay.start,
                              width: virtualDay.size,
                            }}
                          >
                            <div className="border-b border-slate-200 px-2 py-2 text-center text-xs font-semibold text-sky-900">
                              {day.businessDate.slice(8, 10)}/{day.businessDate.slice(5, 7)}
                              <span className="ml-1 text-slate-500">
                                {weekdayLabels[day.dayOfWeek]} · W{day.weekOfMonth}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 text-center text-xs text-slate-600">
                              <span className="border-r border-slate-200 px-1 py-2">Doanh số</span>
                              <span className="px-1 py-2">Live phút</span>
                            </div>
                          </div>
                        );
                      })}
                      <TotalsHeader />
                    </div>

                    {rows.map((row, rowIndex) => (
                      <div
                        className="relative h-28 border-b border-slate-200 bg-white"
                        key={row.staff.id}
                      >
                        <IdentityCell row={row} />
                        {virtualDays.map((virtualDay) => {
                          const day = row.days[virtualDay.index]!;
                          return (
                            <div
                              className="absolute top-0 grid h-28 grid-cols-2 border-r border-slate-200 p-2"
                              key={day.businessDate}
                              style={{
                                left: virtualDay.start,
                                width: virtualDay.size,
                              }}
                            >
                              <MetricInput
                                ariaLabel={`Doanh số ${row.staff.staffCode} ${day.businessDate}`}
                                disabled={Boolean(day.archivedAt) || day.saveState === "saving"}
                                onChange={(value) =>
                                  updateMetric(
                                    row.staff.id,
                                    day.businessDate,
                                    "revenueAmount",
                                    value,
                                  )
                                }
                                onKeyDown={(event) =>
                                  moveFocus(event, rowIndex, virtualDay.index, 0)
                                }
                                onPaste={(event) =>
                                  pasteCells(event, rowIndex, virtualDay.index, 0)
                                }
                                cellId={cellId(row.staff.id, day.businessDate, 0)}
                                value={day.revenueAmount}
                              />
                              <MetricInput
                                ariaLabel={`Live phút ${row.staff.staffCode} ${day.businessDate}`}
                                disabled={Boolean(day.archivedAt) || day.saveState === "saving"}
                                onChange={(value) =>
                                  updateMetric(
                                    row.staff.id,
                                    day.businessDate,
                                    "actualLiveMinutes",
                                    value,
                                  )
                                }
                                onKeyDown={(event) =>
                                  moveFocus(event, rowIndex, virtualDay.index, 1)
                                }
                                onPaste={(event) =>
                                  pasteCells(event, rowIndex, virtualDay.index, 1)
                                }
                                cellId={cellId(row.staff.id, day.businessDate, 1)}
                                value={String(day.actualLiveMinutes)}
                              />
                              <div className="col-span-2 mt-1 text-center text-[11px]">
                                <SaveBadge day={day} />
                              </div>
                            </div>
                          );
                        })}
                        <TotalsCell row={row} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3 lg:hidden">
                <p className="text-xs text-slate-500">
                  Chế độ mobile chỉ đọc; dùng desktop để chỉnh sửa nhiều ô.
                </p>
                {rows.map((row) => (
                  <article className="rounded-xl border border-slate-200 p-4" key={row.staff.id}>
                    <h3 className="font-semibold">{row.staff.fullName}</h3>
                    <p className="text-sm text-slate-500">
                      {row.staff.staffCode} · {row.staff.streamingAlias || "Chưa có alias"} ·{" "}
                      {row.staff.performanceLevel?.name ?? "Chưa xếp hạng"}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <span>Doanh số: {money(row.totals.revenueAmount)} ₫</span>
                      <span>Live: {duration(row.totals.actualLiveMinutes)}</span>
                      <span>Công: {row.totals.workUnits}</span>
                      <span>Phạt: {money(row.totals.penaltyAmount)} ₫</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-8 rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold">Doanh số theo nhân viên</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Đơn vị biểu đồ: triệu VND; số tổng phía trên giữ nguyên BIGINT.
                </p>
                <div className="mt-4 h-80">
                  <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" interval={0} tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar
                        dataKey="revenueMillions"
                        fill="#0284c7"
                        name="Doanh số (triệu VND)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </>
      )}
      <Button
        className="mt-4 bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
        onClick={() => void load()}
        type="button"
      >
        Tải lại dữ liệu nguồn
      </Button>
    </section>
  );
}

function savedDay(day: EditableDay, attendance: AttendanceRecordDto): EditableDay {
  return {
    ...day,
    attendanceId: attendance.id,
    version: attendance.version,
    archivedAt: attendance.archivedAt,
    status: attendance.status,
    revenueAmount: attendance.revenueAmount,
    actualLiveMinutes: attendance.actualLiveMinutes,
    workUnits: attendance.workUnits,
    overtimeMinutes: attendance.overtimeMinutes,
    dirtyRevenue: false,
    dirtyLive: false,
    saveState: "saved",
    message: "Đã lưu vào hồ sơ ngày.",
  };
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function IdentityHeader() {
  return (
    <div
      className="sticky left-0 z-50 grid h-20 grid-cols-[90px_160px_105px_115px] border-r border-slate-300 bg-slate-100 text-xs font-semibold"
      style={{ width: IDENTITY_WIDTH }}
    >
      <span className="flex items-center px-2">Mã NV</span>
      <span className="flex items-center px-2">Nhân viên / ACC</span>
      <span className="flex items-center px-2">Loại / trạng thái</span>
      <span className="flex items-center px-2">Cấp bậc</span>
    </div>
  );
}

function IdentityCell({ row }: Readonly<{ row: EditableRow }>) {
  return (
    <div
      className="sticky left-0 z-20 grid h-28 grid-cols-[90px_160px_105px_115px] border-r border-slate-300 bg-white text-xs"
      style={{ width: IDENTITY_WIDTH }}
    >
      <span className="flex items-center px-2 font-mono">{row.staff.staffCode}</span>
      <span className="flex flex-col justify-center px-2">
        <strong>{row.staff.fullName}</strong>
        <span className="mt-1 text-slate-500">{row.staff.streamingAlias || "Chưa có ACC"}</span>
      </span>
      <span className="flex flex-col justify-center px-2">
        {employmentCategoryLabels[row.staff.employmentCategory]}
        <span className="mt-1 text-slate-500">
          {employmentStatusLabels[row.staff.employmentStatus]}
        </span>
      </span>
      <span className="flex items-center px-2">
        {row.staff.performanceLevel?.name ?? "Chưa xếp hạng"}
      </span>
    </div>
  );
}

function TotalsHeader() {
  return (
    <div
      className="sticky right-0 z-50 ml-auto grid h-20 grid-cols-5 border-l border-slate-300 bg-slate-100 text-center text-xs font-semibold"
      style={{ width: TOTAL_WIDTH }}
    >
      <span className="flex items-center justify-center px-1">Tổng doanh số</span>
      <span className="flex items-center justify-center px-1">Công</span>
      <span className="flex items-center justify-center px-1">Live</span>
      <span className="flex items-center justify-center px-1">Tăng ca</span>
      <span className="flex items-center justify-center px-1">Phạt</span>
    </div>
  );
}

function TotalsCell({ row }: Readonly<{ row: EditableRow }>) {
  return (
    <div
      className="sticky right-0 z-20 ml-auto grid h-28 grid-cols-5 border-l border-slate-300 bg-white text-center text-xs"
      style={{ width: TOTAL_WIDTH }}
    >
      <span className="flex items-center justify-end px-2 font-medium">
        {money(row.totals.revenueAmount)}
      </span>
      <span className="flex items-center justify-center px-1">{row.totals.workUnits}</span>
      <span className="flex items-center justify-center px-1">
        {duration(row.totals.actualLiveMinutes)}
      </span>
      <span className="flex items-center justify-center px-1">
        {duration(row.totals.overtimeMinutes)}
      </span>
      <span className="flex items-center justify-end px-2 text-rose-700">
        {money(row.totals.penaltyAmount)}
      </span>
    </div>
  );
}

function MetricInput({
  ariaLabel,
  cellId,
  disabled,
  onChange,
  onKeyDown,
  onPaste,
  value,
}: Readonly<{
  ariaLabel: string;
  cellId: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  value: string;
}>) {
  return (
    <input
      aria-label={ariaLabel}
      className="min-w-0 px-1 text-right text-xs"
      disabled={disabled}
      id={cellId}
      inputMode="numeric"
      min="0"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      step="1"
      type="number"
      value={value}
    />
  );
}

function SaveBadge({ day }: Readonly<{ day: EditableDay }>) {
  if (day.archivedAt) return <span className="text-slate-400">Đã lưu trữ</span>;
  const labels: Record<SaveState, string> = {
    idle: day.attendanceId ? `v${day.version}` : "Chưa có record",
    dirty: "Chờ lưu",
    saving: "Đang lưu…",
    saved: "Đã lưu",
    conflict: "Xung đột — tải lại",
    error: "Lỗi lưu",
  };
  return (
    <span
      className={
        day.saveState === "conflict" || day.saveState === "error"
          ? "font-medium text-rose-700"
          : "text-slate-500"
      }
      title={day.message ?? undefined}
    >
      {labels[day.saveState]}
    </span>
  );
}
