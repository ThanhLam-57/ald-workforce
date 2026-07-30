"use client";

import type {
  AttendanceRecordDto,
  BranchMonthlyOverviewDto,
  BranchOverviewCellResultDto,
  BranchOverviewDayDto,
  BranchOverviewRowDto,
  BranchOverviewTotalsDto,
} from "@ald/contracts";
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

import {
  groupBranchOverviewWeeks,
  overviewTotals,
  type BranchOverviewCalendarDay,
  type BranchOverviewWeek,
} from "./branch-overview-weekly";
import {
  compactChartNumber,
  responsiveTooltipStyle,
  truncateChartLabel,
} from "./chart-format";
import { useReportingAutoRefresh } from "./use-reporting-auto-refresh";

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

const IDENTITY_WIDTH = 280;
const DAY_WIDTH = 136;
const TOTAL_WIDTH = 260;
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

function coinThousands(value: string): number {
  return Number(BigInt(value) / 10n) / 100;
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}g ${rest.toString().padStart(2, "0")}p` : `${rest}p`;
}

function shortDate(businessDate: string): string {
  return `${businessDate.slice(8, 10)}/${businessDate.slice(5, 7)}`;
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
  const [chartWeekNo, setChartWeekNo] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const [dataset, setDataset] = useState<BranchMonthlyOverviewDto | null>(null);
  const [rows, setRows] = useState<readonly EditableRow[]>([]);
  const [loading, setLoading] = useState(branches.length > 0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rowsRef = useRef(rows);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const loadSequence = useRef(0);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const calendar = dataset?.calendar ?? [];
  const weeks = groupBranchOverviewWeeks(calendar);

  const load = useCallback(
    async (silent = false) => {
      if (!branchId) return;
      const sequence = ++loadSequence.current;
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      if (!silent) {
        setLoading(true);
        setPermissionDenied(false);
        setMessage(null);
      }
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
          const denied = response.status === 403 || response.status === 404;
          if (!silent || denied) {
            setDataset(null);
            setRows([]);
          }
          setPermissionDenied(denied);
          setMessage(payloadError(payload));
          return;
        }
        const overview = payload.data as BranchMonthlyOverviewDto;
        setPermissionDenied(false);
        setDataset(overview);
        setRows(editableRows(overview.rows));
      } catch {
        if (sequence !== loadSequence.current) return;
        if (!silent) {
          setDataset(null);
          setRows([]);
        }
        setMessage("Mất kết nối khi tải bảng tổng quan.");
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [branchId, deferredSearch, employmentCategory, employmentStatus, levelId, month],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const refreshFromSource = useCallback(async () => {
    const hasPendingEdits = rowsRef.current.some((row) =>
      row.days.some((day) => day.dirtyLive || day.dirtyRevenue || day.saveState === "saving"),
    );
    if (hasPendingEdits || timers.current.size > 0) return;
    await load(true);
  }, [load]);

  useReportingAutoRefresh(refreshFromSource, { enabled: branches.length > 0 });

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
        return { ...row, days, totals: overviewTotals(days) };
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
    let nextRowIndex = rowIndex;
    let nextDayIndex = dayIndex;
    let nextMetric: 0 | 1 = metric;
    if (event.key === "ArrowLeft") nextDayIndex -= 1;
    if (event.key === "ArrowRight") nextDayIndex += 1;
    if (event.key === "ArrowUp") {
      if (metric === 1) nextMetric = 0;
      else {
        nextRowIndex -= 1;
        nextMetric = 1;
      }
    }
    if (event.key === "ArrowDown") {
      if (metric === 0) nextMetric = 1;
      else {
        nextRowIndex += 1;
        nextMetric = 0;
      }
    }
    if (nextDayIndex < 0) return;
    const nextRow = rowsRef.current[nextRowIndex];
    const nextDay = nextRow?.days[nextDayIndex];
    if (!nextRow || !nextDay) return;
    event.preventDefault();
    window.requestAnimationFrame(() => {
      const nextCell = document.getElementById(
        cellId(nextRow.staff.id, nextDay.businessDate, nextMetric),
      );
      nextCell?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      nextCell?.focus({ preventScroll: true });
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
  const visibleTotals = overviewTotals(rows.flatMap((row) => row.days));
  const hasPendingEdits = rows.some((row) =>
    row.days.some((day) => day.dirtyLive || day.dirtyRevenue || day.saveState === "saving"),
  );
  const chartData = rows.map((row) => ({
    name: row.staff.streamingAlias || row.staff.fullName,
    coinThousands: coinThousands(row.totals.revenueAmount),
  }));
  const selectedChartWeek =
    weeks.find((week) => week.weekNo === chartWeekNo) ?? weeks[0] ?? null;
  const selectedWeekDates = new Set(
    selectedChartWeek?.days.map((day) => day.businessDate) ?? [],
  );
  const weeklyChartData = rows.map((row) => {
    const totals = overviewTotals(
      row.days.filter((day) => selectedWeekDates.has(day.businessDate)),
    );
    return {
      name: row.staff.streamingAlias || row.staff.fullName,
      coinThousands: coinThousands(totals.revenueAmount),
    };
  });
  const selectedWeekTotals = overviewTotals(
    rows.flatMap((row) =>
      row.days.filter((day) => selectedWeekDates.has(day.businessDate)),
    ),
  );

  function renderWeek(week: BranchOverviewWeek) {
    const gridStyle = {
      gridTemplateColumns: `${IDENTITY_WIDTH}px repeat(${week.days.length}, minmax(${DAY_WIDTH}px, 1fr)) ${TOTAL_WIDTH}px`,
      minWidth: IDENTITY_WIDTH + week.days.length * DAY_WIDTH + TOTAL_WIDTH,
    };
    return (
      <section
        aria-labelledby={`overview-week-title-${week.weekNo}`}
        data-testid={`overview-week-${week.weekNo}`}
        key={week.weekNo}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3
            className="font-semibold text-slate-900"
            id={`overview-week-title-${week.weekNo}`}
          >
            Tuần {week.weekNo} · {shortDate(week.from)}–{shortDate(week.to)}
          </h3>
          <span className="text-xs text-slate-500">{week.days.length} ngày trong tháng</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <div className="grid min-w-full" style={gridStyle}>
            <IdentityHeader />
            {week.days.map((day) => (
              <DayHeader day={day} key={day.businessDate} />
            ))}
            <TotalsHeader />
          </div>
          {rows.map((row, rowIndex) => {
            const daysByDate = new Map(row.days.map((day) => [day.businessDate, day]));
            const weekDays = week.days.flatMap((calendarDay) => {
              const day = daysByDate.get(calendarDay.businessDate);
              return day ? [day] : [];
            });
            const totals = overviewTotals(weekDays);
            return (
              <div
                className="grid min-w-full border-t border-slate-200 bg-white"
                data-testid={`overview-row-${week.weekNo}-${row.staff.id}`}
                key={row.staff.id}
                style={gridStyle}
              >
                <IdentityCell row={row} weekNo={week.weekNo} />
                {week.days.map((calendarDay) => {
                  const day = daysByDate.get(calendarDay.businessDate);
                  const dayIndex = row.days.findIndex(
                    (candidate) => candidate.businessDate === calendarDay.businessDate,
                  );
                  if (!day || dayIndex < 0) return null;
                  return (
                    <div
                      className="relative grid min-h-28 grid-rows-2 border-r border-slate-300"
                      data-business-date={day.businessDate}
                      key={day.businessDate}
                    >
                      {isGeneralManager ? (
                        <>
                          <div className="flex items-center border-b border-slate-200 px-2 py-1">
                            <MetricInput
                              ariaLabel={`Số xu ${row.staff.staffCode} ${day.businessDate}`}
                              disabled={Boolean(day.archivedAt) || day.saveState === "saving"}
                              onChange={(value) =>
                                updateMetric(
                                  row.staff.id,
                                  day.businessDate,
                                  "revenueAmount",
                                  value,
                                )
                              }
                              onKeyDown={(event) => moveFocus(event, rowIndex, dayIndex, 0)}
                              onPaste={(event) => pasteCells(event, rowIndex, dayIndex, 0)}
                              cellId={cellId(row.staff.id, day.businessDate, 0)}
                              value={day.revenueAmount}
                            />
                          </div>
                          <div className="flex items-center px-2 pt-1 pb-4">
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
                              onKeyDown={(event) => moveFocus(event, rowIndex, dayIndex, 1)}
                              onPaste={(event) => pasteCells(event, rowIndex, dayIndex, 1)}
                              cellId={cellId(row.staff.id, day.businessDate, 1)}
                              value={String(day.actualLiveMinutes)}
                            />
                          </div>
                          <div className="absolute inset-x-1 bottom-0.5 truncate text-center text-[10px]">
                            <SaveBadge day={day} />
                          </div>
                        </>
                      ) : (
                        <>
                          <span
                            aria-label={`Số xu ${row.staff.staffCode} ${day.businessDate}`}
                            className="flex items-center justify-end border-b border-slate-200 px-2 text-xs font-medium"
                          >
                            {money(day.revenueAmount)}
                          </span>
                          <span
                            aria-label={`Live ${row.staff.staffCode} ${day.businessDate}`}
                            className="flex items-center justify-center px-2 text-xs"
                          >
                            {duration(day.actualLiveMinutes)}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
                <TotalsCell
                  staffId={row.staff.id}
                  staffCode={row.staff.staffCode}
                  totals={totals}
                  weekNo={week.weekNo}
                />
              </div>
            );
          })}
        </div>
      </section>
    );
  }

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
            Tổng hợp trực tiếp số xu và thời gian Live theo ngày
          </p>
        </div>
        {isGeneralManager ? (
          <a
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
            href={`/api/exports/branch-monthly-overview?${exportQuery}`}
          >
            Xuất XLSX
          </a>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Chỉ xem
          </span>
        )}
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
            <SummaryCard label="Tổng xu cơ sở" value={`${money(visibleTotals.revenueAmount)} xu`} />
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
              <div
                className="mt-6 hidden space-y-6 lg:block"
                data-testid="overview-week-list"
              >
                {isGeneralManager ? (
                  <p className="text-xs text-slate-500">
                    Có thể paste vùng TSV từ Excel; toàn bộ vùng được kiểm tra trước khi lưu.
                  </p>
                ) : null}
                {weeks.map(renderWeek)}
              </div>

              <div className="mt-6 space-y-3 lg:hidden">
                <p className="text-xs text-slate-500">
                  {isGeneralManager
                    ? "Chế độ mobile chỉ đọc; dùng desktop để chỉnh sửa nhiều ô."
                    : "Báo cáo chỉ đọc trong phạm vi cơ sở được phân công."}
                </p>
                {rows.map((row) => (
                  <article className="rounded-xl border border-slate-200 p-4" key={row.staff.id}>
                    <h3 className="font-semibold">{row.staff.fullName}</h3>
                    <p className="text-sm text-slate-500">
                      {row.staff.staffCode} · {row.staff.streamingAlias || "Chưa có alias"} ·{" "}
                      {row.staff.performanceLevel?.name ?? "Chưa xếp hạng"}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <span>Tổng xu: {money(row.totals.revenueAmount)} xu</span>
                      <span>Live: {duration(row.totals.actualLiveMinutes)}</span>
                      <span>Công: {row.totals.workUnits}</span>
                      <span>Phạt: {money(row.totals.penaltyAmount)} ₫</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-8 grid gap-4 xl:grid-cols-2">
                <div
                  className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4"
                  data-testid="monthly-revenue-chart"
                >
                  <h3 className="break-words font-semibold [overflow-wrap:anywhere]">
                    Tổng xu theo nhân viên
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Cả tháng · đơn vị biểu đồ là nghìn xu.
                  </p>
                  <div className="mt-4 h-80 min-w-0 overflow-hidden">
                    <ResponsiveContainer height="100%" width="100%">
                      <BarChart
                        data={chartData}
                        margin={{ top: 8, right: 8, bottom: 20, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="name"
                          height={48}
                          interval={0}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => truncateChartLabel(value, 16)}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={compactChartNumber}
                          width={64}
                        />
                        <Tooltip
                          contentStyle={responsiveTooltipStyle}
                          itemStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          labelStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          wrapperStyle={{ maxWidth: "calc(100vw - 2rem)", zIndex: 60 }}
                        />
                        <Bar
                          dataKey="coinThousands"
                          fill="#0284c7"
                          name="Tổng xu tháng (nghìn xu)"
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div
                  className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4"
                  data-testid="weekly-revenue-chart"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="break-words font-semibold [overflow-wrap:anywhere]">
                        Tổng xu theo nhân viên từng tuần
                      </h3>
                      <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                        {selectedChartWeek
                          ? `Tuần ${selectedChartWeek.weekNo} · ${shortDate(selectedChartWeek.from)}–${shortDate(selectedChartWeek.to)} · ${money(selectedWeekTotals.revenueAmount)} xu`
                          : "Chưa có tuần trong tháng."}
                      </p>
                    </div>
                    <div
                      aria-label="Chọn tuần biểu đồ xu"
                      className="flex flex-wrap gap-1"
                      role="group"
                    >
                      {weeks.map((week) => {
                        const selected = week.weekNo === selectedChartWeek?.weekNo;
                        return (
                          <button
                            aria-pressed={selected}
                            className={
                              selected
                                ? "rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white"
                                : "rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                            }
                            key={week.weekNo}
                            onClick={() => setChartWeekNo(week.weekNo)}
                            type="button"
                          >
                            Tuần {week.weekNo}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-4 h-80 min-w-0 overflow-hidden">
                    <ResponsiveContainer height="100%" width="100%">
                      <BarChart
                        data={weeklyChartData}
                        margin={{ top: 8, right: 8, bottom: 20, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="name"
                          height={48}
                          interval={0}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => truncateChartLabel(value, 16)}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={compactChartNumber}
                          width={64}
                        />
                        <Tooltip
                          contentStyle={responsiveTooltipStyle}
                          itemStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          labelStyle={{ overflowWrap: "anywhere", whiteSpace: "normal" }}
                          wrapperStyle={{ maxWidth: "calc(100vw - 2rem)", zIndex: 60 }}
                        />
                        <Bar
                          dataKey="coinThousands"
                          fill="#0f766e"
                          name={`Tuần ${selectedChartWeek?.weekNo ?? ""} (nghìn xu)`}
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
      <Button
        className="mt-4"
        disabled={loading || hasPendingEdits}
        onClick={() => void load()}
        type="button"
        variant="secondary"
      >
        {hasPendingEdits ? "Lưu xong để cập nhật" : "Cập nhật dữ liệu nguồn"}
      </Button>
      <p className="mt-2 text-xs text-slate-500">
        Tự động đồng bộ khi quay lại trang và mỗi 30 giây. Hệ thống không ghi đè ô đang sửa hoặc
        đang chờ lưu.
      </p>
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
    <div className="min-w-0 rounded-xl bg-slate-50 p-4 [overflow-wrap:anywhere]">
      <p className="break-words text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold">{value}</p>
    </div>
  );
}

function IdentityHeader() {
  return (
    <div className="sticky left-0 z-50 flex h-24 items-center border-r border-slate-300 bg-slate-100 px-3 text-xs font-semibold shadow-[4px_0_6px_-5px_rgba(15,23,42,0.45)]">
      Thông tin nhân viên
    </div>
  );
}

function DayHeader({ day }: Readonly<{ day: BranchOverviewCalendarDay }>) {
  return (
    <div className="h-24 border-r border-slate-300 bg-sky-50">
      <div className="flex h-10 items-center justify-center border-b border-slate-200 px-2 text-center text-xs font-semibold text-sky-900">
        {shortDate(day.businessDate)}
        <span className="ml-1 text-slate-500">{weekdayLabels[day.dayOfWeek]}</span>
      </div>
      <div className="grid h-14 grid-rows-2 text-center text-xs text-slate-600">
        <span className="flex items-center justify-center border-b border-slate-200 px-1">Xu</span>
        <span className="flex items-center justify-center px-1">Live</span>
      </div>
    </div>
  );
}

function IdentityCell({ row, weekNo }: Readonly<{ row: EditableRow; weekNo: number }>) {
  return (
    <div
      className="sticky left-0 z-20 flex min-h-28 flex-col justify-center border-r border-slate-300 bg-white px-3 py-2 text-xs shadow-[4px_0_6px_-5px_rgba(15,23,42,0.35)]"
      data-testid={`overview-identity-${weekNo}-${row.staff.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0 truncate text-sm">{row.staff.fullName}</strong>
        <span className="shrink-0 font-mono text-[11px] text-slate-500">
          {row.staff.staffCode}
        </span>
      </div>
      <span className="mt-1 truncate text-slate-600">
        ACC: {row.staff.streamingAlias || "Chưa có"}
      </span>
      <span className="mt-1 text-slate-500">
        {employmentCategoryLabels[row.staff.employmentCategory]} ·{" "}
        {employmentStatusLabels[row.staff.employmentStatus]} ·{" "}
        {row.staff.performanceLevel?.name ?? "Chưa xếp hạng"}
      </span>
    </div>
  );
}

function TotalsHeader() {
  return (
    <div className="sticky right-0 z-50 flex h-24 items-center justify-center border-l border-slate-300 bg-slate-100 px-3 text-center text-xs font-semibold shadow-[-4px_0_6px_-5px_rgba(15,23,42,0.45)]">
      Tổng tuần
    </div>
  );
}

function TotalsCell({
  staffCode,
  staffId,
  totals,
  weekNo,
}: Readonly<{
  staffCode: string;
  staffId: string;
  totals: BranchOverviewTotalsDto;
  weekNo: number;
}>) {
  return (
    <div
      aria-label={`Tổng tuần ${weekNo} ${staffCode}`}
      className="sticky right-0 z-20 grid min-h-28 grid-cols-2 content-center gap-x-3 gap-y-1 border-l border-slate-300 bg-white px-3 py-2 text-xs shadow-[-4px_0_6px_-5px_rgba(15,23,42,0.35)]"
      data-testid={`overview-total-${weekNo}-${staffId}`}
    >
      <span className="col-span-2 flex justify-between gap-2 font-semibold">
        <span className="text-slate-500">Xu</span>
        <span>{money(totals.revenueAmount)}</span>
      </span>
      <span>
        <span className="text-slate-500">Công </span>
        {totals.workUnits}
      </span>
      <span>
        <span className="text-slate-500">Live </span>
        {duration(totals.actualLiveMinutes)}
      </span>
      <span>
        <span className="text-slate-500">Tăng ca </span>
        {duration(totals.overtimeMinutes)}
      </span>
      <span className="text-rose-700">
        <span className="text-slate-500">Phạt </span>
        {money(totals.penaltyAmount)}
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
      className="w-full min-w-0 px-1 text-right text-xs"
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
