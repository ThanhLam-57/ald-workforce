"use client";

import type {
  AttendanceMonthDayDto,
  AttendanceMonthDto,
  AttendanceRecordDto,
  ViolationDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { AttendanceViolations } from "./attendance-violations";

type StaffOption = Readonly<{
  id: string;
  staffCode: string;
  fullName: string;
  jobTitle: string;
}>;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

type EditableDay = Readonly<{
  businessDate: string;
  dayOfWeek: number;
  record: AttendanceRecordDto | null;
  checkInTime: string;
  checkOutTime: string;
  spansNextDay: boolean;
  workUnits: string;
  overtimeMinutes: string;
  note: string;
  status: AttendanceRecordDto["status"];
  actualLiveMinutes: string;
  revenueAmount: string;
  saveState: SaveState;
  message: string | null;
  conflictRecord: AttendanceRecordDto | null;
  violations: readonly ViolationDto[];
  activePenaltyTotal: string;
}>;

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{
    code?: unknown;
    message?: unknown;
    details?: unknown;
  }>;
}>;

const weekdayLabels = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"] as const;

const statusLabels = {
  DRAFT: "Nháp",
  PRESENT: "Có mặt",
  ABSENT: "Vắng",
  LEAVE: "Nghỉ phép",
} as const;

const saveLabels: Record<SaveState, string> = {
  idle: "Chưa nhập",
  dirty: "Chờ lưu",
  saving: "Đang lưu…",
  saved: "Đã lưu",
  error: "Lỗi lưu",
  conflict: "Xung đột",
};

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}`;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function displayTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function timestampFor(businessDate: string, time: string, nextBusinessDay = false): string | null {
  if (!time) return null;
  const date = nextBusinessDay ? nextDate(businessDate) : businessDate;
  return `${date}T${time}:00+07:00`;
}

function editableDay(day: AttendanceMonthDayDto): EditableDay {
  const record = day.attendance;
  return {
    businessDate: day.businessDate,
    dayOfWeek: day.dayOfWeek,
    record,
    checkInTime: displayTime(record?.checkInAt ?? null),
    checkOutTime: displayTime(record?.checkOutAt ?? null),
    spansNextDay: record?.spansNextDay ?? false,
    workUnits: record?.workUnits ?? "0",
    overtimeMinutes: String(record?.overtimeMinutes ?? 0),
    note: record?.note ?? "",
    status: record?.status ?? "DRAFT",
    actualLiveMinutes: String(record?.actualLiveMinutes ?? 0),
    revenueAmount: record?.revenueAmount ?? "0",
    saveState: record ? "saved" : "idle",
    message: null,
    conflictRecord: null,
    violations: day.violations,
    activePenaltyTotal: day.activePenaltyTotal,
  };
}

function errorMessage(payload: ApiPayload, fallback: string): string {
  return typeof payload.error?.message === "string" ? payload.error.message : fallback;
}

function conflictRecord(payload: ApiPayload): AttendanceRecordDto | null {
  const details = payload.error?.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !("current" in details) ||
    typeof details.current !== "object" ||
    details.current === null ||
    !("id" in details.current) ||
    !("version" in details.current)
  ) {
    return null;
  }
  return details.current as AttendanceRecordDto;
}

function rowFromRecord(day: EditableDay, record: AttendanceRecordDto): EditableDay {
  return editableDay({
    businessDate: day.businessDate,
    dayOfWeek: day.dayOfWeek,
    attendance: record,
    violations: day.violations,
    activePenaltyTotal: day.activePenaltyTotal,
  });
}

function moveGridFocus(event: KeyboardEvent<HTMLElement>, rowIndex: number, columnIndex: number) {
  const movements: Partial<Record<string, readonly [number, number]>> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const movement = movements[event.key];
  if (!movement) return;

  const [rowDelta, columnDelta] = movement;
  const next = document.querySelector<HTMLElement>(
    `[data-grid-row="${rowIndex + rowDelta}"][data-grid-col="${columnIndex + columnDelta}"]`,
  );
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

export function AttendanceWorkspace({
  staff,
  canOverridePenalty,
}: Readonly<{
  staff: readonly StaffOption[];
  canOverridePenalty: boolean;
}>) {
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [month, setMonth] = useState(currentMonth);
  const [reason, setReason] = useState("");
  const [dataset, setDataset] = useState<AttendanceMonthDto | null>(null);
  const [days, setDays] = useState<readonly EditableDay[]>([]);
  const [loading, setLoading] = useState(staff.length > 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [view, setView] = useState<"daily" | "monthly">("daily");
  const [refreshToken, setRefreshToken] = useState(0);
  const daysRef = useRef(days);
  const reasonRef = useRef(reason);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    daysRef.current = days;
  }, [days]);

  useEffect(() => {
    reasonRef.current = reason;
  }, [reason]);

  const replaceDay = useCallback(
    (businessDate: string, update: (day: EditableDay) => EditableDay) => {
      setDays((current) =>
        current.map((day) => (day.businessDate === businessDate ? update(day) : day)),
      );
    },
    [],
  );

  const saveDay = useCallback(
    async (businessDate: string, override?: EditableDay) => {
      const day =
        override ?? daysRef.current.find((candidate) => candidate.businessDate === businessDate);
      if (!day || day.record?.archivedAt || day.saveState === "saving") return;

      const auditReason = reasonRef.current.trim();
      if (!auditReason) {
        replaceDay(businessDate, (current) => ({
          ...current,
          saveState: "error",
          message: "Nhập lý do thay đổi trước khi autosave.",
        }));
        return;
      }

      replaceDay(businessDate, (current) => ({
        ...current,
        saveState: "saving",
        message: null,
      }));

      const values = {
        checkInAt: timestampFor(businessDate, day.checkInTime),
        checkOutAt: timestampFor(businessDate, day.checkOutTime, day.spansNextDay),
        spansNextDay: day.spansNextDay,
        workUnits: day.workUnits || "0",
        overtimeMinutes: Number(day.overtimeMinutes || 0),
        note: day.note || null,
        status: day.status,
        actualLiveMinutes: Number(day.actualLiveMinutes || 0),
        revenueAmount: day.revenueAmount || "0",
        reason: auditReason,
      };
      const response = await fetch(
        day.record ? `/api/attendance/${day.record.id}` : "/api/attendance",
        {
          method: day.record ? "PATCH" : "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            day.record
              ? { ...values, version: day.record.version }
              : { ...values, staffId, businessDate },
          ),
        },
      );
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok) {
        const current = response.status === 409 ? conflictRecord(payload) : null;
        replaceDay(businessDate, (latest) => ({
          ...latest,
          saveState: response.status === 409 ? "conflict" : "error",
          message: errorMessage(payload, "Không thể lưu attendance."),
          conflictRecord: current,
        }));
        return;
      }

      const record = payload.data as AttendanceRecordDto;
      replaceDay(businessDate, (latest) => ({
        ...rowFromRecord(latest, record),
        saveState: "saved",
        message: "Đã lưu",
      }));
    },
    [replaceDay, staffId],
  );

  const scheduleSave = useCallback(
    (businessDate: string) => {
      const current = timers.current.get(businessDate);
      if (current) clearTimeout(current);
      timers.current.set(
        businessDate,
        setTimeout(() => {
          timers.current.delete(businessDate);
          void saveDay(businessDate);
        }, 700),
      );
    },
    [saveDay],
  );

  useEffect(() => {
    if (!staffId) {
      return;
    }

    const controller = new AbortController();
    void fetch(
      `/api/attendance?staffId=${encodeURIComponent(staffId)}&month=${encodeURIComponent(month)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = (await response.json()) as ApiPayload;
        if (!response.ok) {
          if (response.status === 403) setPermissionDenied(true);
          throw new Error(errorMessage(payload, "Không thể tải attendance."));
        }
        const nextDataset = payload.data as AttendanceMonthDto;
        setDataset(nextDataset);
        setDays(nextDataset.days.map(editableDay));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataset(null);
        setDays([]);
        setLoadError(error instanceof Error ? error.message : "Không thể tải attendance.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [month, refreshToken, staffId]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  function updateField<K extends keyof EditableDay>(
    businessDate: string,
    field: K,
    value: EditableDay[K],
  ) {
    replaceDay(businessDate, (day) => ({
      ...day,
      [field]: value,
      saveState: "dirty",
      message: null,
      conflictRecord: null,
    }));
    scheduleSave(businessDate);
  }

  function refreshAttendance() {
    setLoading(true);
    setRefreshToken((current) => current + 1);
  }

  function reloadConflict(businessDate: string) {
    replaceDay(businessDate, (day) =>
      day.conflictRecord ? rowFromRecord(day, day.conflictRecord) : day,
    );
  }

  function mergeConflict(businessDate: string) {
    const day = daysRef.current.find((candidate) => candidate.businessDate === businessDate);
    if (!day?.conflictRecord || day.conflictRecord.archivedAt) return;
    const merged: EditableDay = {
      ...day,
      record: day.conflictRecord,
      saveState: "dirty",
      message: "Đã ghép thay đổi cục bộ lên phiên bản mới nhất.",
      conflictRecord: null,
    };
    replaceDay(businessDate, () => merged);
    void saveDay(businessDate, merged);
  }

  async function archiveDay(day: EditableDay) {
    if (!day.record || day.record.archivedAt) return;
    const auditReason = reasonRef.current.trim();
    if (!auditReason) {
      replaceDay(day.businessDate, (current) => ({
        ...current,
        saveState: "error",
        message: "Nhập lý do trước khi lưu trữ.",
      }));
      return;
    }
    if (!window.confirm(`Lưu trữ attendance ngày ${displayDate(day.businessDate)}?`)) {
      return;
    }

    replaceDay(day.businessDate, (current) => ({
      ...current,
      saveState: "saving",
      message: null,
    }));
    const response = await fetch(`/api/attendance/${day.record.id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: day.record.version,
        reason: auditReason,
      }),
    });
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) {
      const current = response.status === 409 ? conflictRecord(payload) : null;
      replaceDay(day.businessDate, (latest) => ({
        ...latest,
        saveState: response.status === 409 ? "conflict" : "error",
        message: errorMessage(payload, "Không thể lưu trữ attendance."),
        conflictRecord: current,
      }));
      return;
    }
    const record = payload.data as AttendanceRecordDto;
    replaceDay(day.businessDate, (latest) => ({
      ...rowFromRecord(latest, record),
      saveState: "saved",
      message: "Đã lưu trữ; dữ liệu lịch sử không bị xóa.",
    }));
  }

  if (staff.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Attendance & Live</h2>
        <p className="mt-3 text-sm text-slate-500">
          Chưa có nhân viên thuộc phạm vi cơ sở để nhập attendance.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Attendance & Live theo tháng</h2>
          <p className="mt-1 text-sm text-slate-500">
            Autosave sau 700ms · ngày nghiệp vụ Asia/Ho_Chi_Minh
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            className={
              view === "daily"
                ? ""
                : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            }
            onClick={() => setView("daily")}
            type="button"
          >
            Hồ sơ ngày
          </Button>
          <Button
            className={
              view === "monthly"
                ? ""
                : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            }
            onClick={() => setView("monthly")}
            type="button"
          >
            Lưới tháng
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Nhân viên
          <select
            aria-label="Nhân viên attendance"
            onChange={(event) => {
              setLoading(true);
              setLoadError(null);
              setPermissionDenied(false);
              setStaffId(event.target.value);
            }}
            value={staffId}
          >
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.staffCode} — {person.fullName} ({person.jobTitle})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tháng
          <input
            aria-label="Tháng attendance"
            onChange={(event) => {
              setLoading(true);
              setLoadError(null);
              setPermissionDenied(false);
              setMonth(event.target.value);
            }}
            type="month"
            value={month}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Lý do thay đổi
          <input
            aria-label="Lý do thay đổi attendance"
            onChange={(event) => setReason(event.target.value)}
            placeholder="Bắt buộc để ghi audit"
            value={reason}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-600">
          {dataset
            ? `${dataset.staff.staffCode} — ${dataset.staff.fullName} · doanh số ${dataset.revenueConfig.unit} × ${dataset.revenueConfig.scale} · tổng phạt tháng ${new Intl.NumberFormat("vi-VN").format(BigInt(dataset.activePenaltyTotal))} ₫`
            : "Đang chuẩn bị dữ liệu…"}
        </p>
        <a
          className="font-medium text-sky-700 underline underline-offset-4"
          href={`/api/exports/employee-error-report?staffId=${encodeURIComponent(staffId)}&month=${encodeURIComponent(month)}`}
        >
          Xuất employee error report
        </a>
      </div>

      {loading ? (
        <div aria-live="polite" className="mt-6 rounded-xl bg-slate-50 p-8 text-center">
          Đang tải hồ sơ tháng…
        </div>
      ) : permissionDenied ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          Bạn không có quyền xem nhân viên hoặc cơ sở này.
        </div>
      ) : loadError ? (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          {loadError}
        </div>
      ) : days.length === 0 ? (
        <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-slate-500">
          Không có dữ liệu trong tháng đã chọn.
        </div>
      ) : view === "monthly" ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
          <table className="attendance-table min-w-max text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 min-w-52 bg-slate-100">Nhân viên</th>
                {days.map((day) => (
                  <th className="min-w-20 text-center" key={day.businessDate}>
                    {day.businessDate.slice(8, 10)}
                    <span className="block text-xs font-normal text-slate-500">
                      {weekdayLabels[day.dayOfWeek]?.replace("Thứ ", "T")}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left">{dataset?.staff.fullName}</th>
                {days.map((day) => (
                  <td
                    className={`text-center ${day.record?.archivedAt ? "bg-slate-100 text-slate-400" : ""}`}
                    key={day.businessDate}
                    title={day.message ?? statusLabels[day.status]}
                  >
                    <span className="block font-medium">{day.workUnits}</span>
                    <span className="text-xs text-slate-500">
                      {day.record ? statusLabels[day.status] : "—"}
                    </span>
                    {day.activePenaltyTotal !== "0" ? (
                      <span className="block text-xs font-medium text-rose-700">
                        Phạt {new Intl.NumberFormat("vi-VN").format(BigInt(day.activePenaltyTotal))}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6 overflow-auto rounded-xl border border-slate-200">
          <table className="attendance-table min-w-[1500px] text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-30 min-w-28 bg-slate-100">Ngày</th>
                <th className="sticky left-28 z-30 min-w-24 bg-slate-100">Thứ</th>
                <th>Trạng thái</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Qua ngày</th>
                <th>Live thực tế</th>
                <th>Tăng ca</th>
                <th>Số công</th>
                <th>Doanh số</th>
                <th className="min-w-64">Ghi chú</th>
                <th className="min-w-96">Lỗi & evidence</th>
                <th>Lưu</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, rowIndex) => {
                const disabled = day.saveState === "saving" || Boolean(day.record?.archivedAt);
                const grid = (column: number) => ({
                  "data-grid-row": rowIndex,
                  "data-grid-col": column,
                  onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
                    moveGridFocus(event, rowIndex, column),
                });
                return (
                  <tr
                    className={day.record?.archivedAt ? "bg-slate-100 text-slate-500" : ""}
                    key={day.businessDate}
                  >
                    <th className="sticky left-0 z-10 bg-inherit text-left">
                      {displayDate(day.businessDate)}
                    </th>
                    <th className="sticky left-28 z-10 bg-inherit text-left font-normal">
                      {weekdayLabels[day.dayOfWeek]}
                    </th>
                    <td>
                      <select
                        {...grid(0)}
                        aria-label={`Trạng thái ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(
                            day.businessDate,
                            "status",
                            event.target.value as EditableDay["status"],
                          )
                        }
                        value={day.status}
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        {...grid(1)}
                        aria-label={`Check-in ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "checkInTime", event.target.value)
                        }
                        type="time"
                        value={day.checkInTime}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(2)}
                        aria-label={`Check-out ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "checkOutTime", event.target.value)
                        }
                        type="time"
                        value={day.checkOutTime}
                      />
                    </td>
                    <td className="text-center">
                      <input
                        {...grid(3)}
                        aria-label={`Ca qua ngày ${day.businessDate}`}
                        checked={day.spansNextDay}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "spansNextDay", event.target.checked)
                        }
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <input
                        {...grid(4)}
                        aria-label={`Live thực tế ${day.businessDate}`}
                        disabled={disabled}
                        min="0"
                        onChange={(event) =>
                          updateField(day.businessDate, "actualLiveMinutes", event.target.value)
                        }
                        step="1"
                        type="number"
                        value={day.actualLiveMinutes}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(5)}
                        aria-label={`Tăng ca ${day.businessDate}`}
                        disabled={disabled}
                        min="0"
                        onChange={(event) =>
                          updateField(day.businessDate, "overtimeMinutes", event.target.value)
                        }
                        step="1"
                        type="number"
                        value={day.overtimeMinutes}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(6)}
                        aria-label={`Số công ${day.businessDate}`}
                        disabled={disabled}
                        min="0"
                        onChange={(event) =>
                          updateField(day.businessDate, "workUnits", event.target.value)
                        }
                        step="0.25"
                        type="number"
                        value={day.workUnits}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(7)}
                        aria-label={`Doanh số ${day.businessDate}`}
                        disabled={disabled}
                        inputMode="numeric"
                        min="0"
                        onChange={(event) =>
                          updateField(day.businessDate, "revenueAmount", event.target.value)
                        }
                        step="1"
                        type="number"
                        value={day.revenueAmount}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(8)}
                        aria-label={`Ghi chú ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "note", event.target.value)
                        }
                        value={day.note}
                      />
                    </td>
                    <td>
                      <AttendanceViolations
                        activePenaltyTotal={day.activePenaltyTotal}
                        attendanceId={day.record?.id ?? null}
                        businessDate={day.businessDate}
                        canOverrideAmount={canOverridePenalty}
                        onChanged={refreshAttendance}
                        reason={reason}
                        violations={day.violations}
                      />
                    </td>
                    <td className="min-w-36">
                      <span
                        aria-live="polite"
                        className={
                          day.saveState === "error" || day.saveState === "conflict"
                            ? "font-medium text-rose-700"
                            : "text-slate-600"
                        }
                      >
                        {day.record?.archivedAt ? "Đã lưu trữ" : saveLabels[day.saveState]}
                      </span>
                      {day.message ? (
                        <span className="mt-1 block max-w-52 text-xs">{day.message}</span>
                      ) : null}
                      {day.saveState === "conflict" && day.conflictRecord ? (
                        <span className="mt-2 flex gap-2">
                          <button
                            className="text-sky-700 underline"
                            onClick={() => reloadConflict(day.businessDate)}
                            type="button"
                          >
                            Tải lại
                          </button>
                          {!day.conflictRecord.archivedAt ? (
                            <button
                              className="text-sky-700 underline"
                              onClick={() => mergeConflict(day.businessDate)}
                              type="button"
                            >
                              Ghép & lưu
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {day.record && !day.record.archivedAt ? (
                        <button
                          className="text-rose-700 underline underline-offset-4"
                          disabled={day.saveState === "saving"}
                          onClick={() => void archiveDay(day)}
                          type="button"
                        >
                          Lưu trữ
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
