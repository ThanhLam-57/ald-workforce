"use client";

import type {
  AttendanceFilterOptionsDto,
  AttendanceMonthDayDto,
  AttendanceMonthDto,
  AttendanceRecordDto,
  AutomaticViolationReconcileSummaryDto,
  ViolationDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  durationInputError,
  formatDurationMinutes,
  isDurationInputDraft,
  isNextDayCheckout,
  parseDurationMinutes,
} from "./attendance-duration";
import { AttendanceMachineImportDialog } from "./attendance-machine-import-dialog";
import { attendanceMachineImportBlockedReason } from "./attendance-machine-import-view";
import { AttendanceViolations } from "./attendance-violations";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type BatchSaveState = "idle" | "saving" | "saved" | "error";

type EditableDay = Readonly<{
  businessDate: string;
  dayOfWeek: number;
  record: AttendanceRecordDto | null;
  checkInTime: string;
  checkOutTime: string;
  workUnits: string;
  overtimeDuration: string;
  note: string;
  actualLiveDuration: string;
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
    workUnits: record?.workUnits ?? "0",
    overtimeDuration: formatDurationMinutes(record?.overtimeMinutes ?? 0),
    note: record?.note ?? "",
    actualLiveDuration: formatDurationMinutes(record?.actualLiveMinutes ?? 0),
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
  initialOptions,
  canOverridePenalty,
}: Readonly<{
  initialOptions: AttendanceFilterOptionsDto;
  canOverridePenalty: boolean;
}>) {
  const [branches, setBranches] = useState(initialOptions.branches);
  const [staff, setStaff] = useState(initialOptions.staff);
  const [branchId, setBranchId] = useState(initialOptions.selectedBranchId ?? "");
  const [staffId, setStaffId] = useState(initialOptions.staff[0]?.id ?? "");
  const [month, setMonth] = useState(initialOptions.month || currentMonth);
  const [dataset, setDataset] = useState<AttendanceMonthDto | null>(null);
  const [days, setDays] = useState<readonly EditableDay[]>([]);
  const [loading, setLoading] = useState(initialOptions.staff.length > 0);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [view, setView] = useState<"daily" | "monthly">("daily");
  const [refreshToken, setRefreshToken] = useState(0);
  const [batchSaveState, setBatchSaveState] = useState<BatchSaveState>("idle");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [reconcilePreview, setReconcilePreview] =
    useState<AutomaticViolationReconcileSummaryDto | null>(null);
  const [reconcilePending, setReconcilePending] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [automaticWarnings, setAutomaticWarnings] = useState<
    AutomaticViolationReconcileSummaryDto["warnings"]
  >([]);
  const [machineImportOpen, setMachineImportOpen] = useState(false);
  const revenueLabel = "Doanh số (xu)";
  const daysRef = useRef(days);
  const inFlight = useRef(new Set<string>());
  const batchSaving = useRef(false);
  const optionsController = useRef<AbortController | null>(null);
  const pendingCount = useMemo(
    () => days.filter((day) => day.saveState === "dirty" || day.saveState === "error").length,
    [days],
  );
  const conflictCount = useMemo(
    () => days.filter((day) => day.saveState === "conflict").length,
    [days],
  );
  const isAnySaving = useMemo(
    () => batchSaveState === "saving" || days.some((day) => day.saveState === "saving"),
    [batchSaveState, days],
  );
  const dailyRewardTotal = useMemo(
    () => days.reduce((total, day) => total + BigInt(day.record?.dailyReward.amount ?? "0"), 0n),
    [days],
  );
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === branchId) ?? null,
    [branchId, branches],
  );
  const selectedStaff = useMemo(
    () => staff.find((person) => person.id === staffId) ?? null,
    [staff, staffId],
  );
  const attendanceMachineCode = dataset?.staff.attendanceMachineCode ?? null;
  const machineImportBlockedReason = attendanceMachineImportBlockedReason({
    branchId,
    staffId,
    month,
    attendanceMachineCode,
    datasetReady: Boolean(dataset),
    optionsLoading,
    attendanceLoading: loading,
    pendingCount,
    conflictCount,
    saving: isAnySaving,
    reconciling: reconcilePending,
    hasReconcilePreview: reconcilePreview !== null,
  });
  const violationInteractionBlockedReason =
    pendingCount > 0 || conflictCount > 0 || isAnySaving
      ? "Hãy lưu hoặc xử lý toàn bộ thay đổi chấm công trước khi mở lỗi và evidence."
      : null;
  const shouldGuardUnsavedChanges = pendingCount > 0 || conflictCount > 0 || isAnySaving;

  useEffect(() => {
    daysRef.current = days;
  }, [days]);

  useEffect(() => {
    if (!shouldGuardUnsavedChanges) return;

    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const blockInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.alert(
        isAnySaving
          ? "Dữ liệu đang được lưu. Vui lòng chờ hoàn tất trước khi rời màn hình."
          : "Còn dữ liệu chấm công chưa lưu. Hãy bấm “Lưu thay đổi” trước khi rời màn hình.",
      );
    };
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    document.addEventListener("click", blockInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
      document.removeEventListener("click", blockInternalNavigation, true);
    };
  }, [isAnySaving, shouldGuardUnsavedChanges]);

  const replaceDay = useCallback(
    (businessDate: string, update: (day: EditableDay) => EditableDay) => {
      setDays((current) => {
        const next = current.map((day) => (day.businessDate === businessDate ? update(day) : day));
        daysRef.current = next;
        return next;
      });
    },
    [],
  );

  const saveDay = useCallback(
    async (businessDate: string, override?: EditableDay): Promise<boolean> => {
      const day =
        override ?? daysRef.current.find((candidate) => candidate.businessDate === businessDate);
      if (!day) return true;
      if (inFlight.current.has(businessDate)) return false;

      const actualLiveMinutes = parseDurationMinutes(day.actualLiveDuration);
      const overtimeMinutes = parseDurationMinutes(day.overtimeDuration);
      if (actualLiveMinutes === null || overtimeMinutes === null) {
        replaceDay(businessDate, (current) => ({
          ...current,
          saveState: "error",
          message:
            actualLiveMinutes === null
              ? "Live thực tế phải có dạng HH:mm, tối đa 48:00."
              : "Tăng ca phải có dạng HH:mm, tối đa 48:00.",
        }));
        return false;
      }

      inFlight.current.add(businessDate);
      replaceDay(businessDate, (current) => ({
        ...current,
        saveState: "saving",
        message: null,
      }));

      const spansNextDay = isNextDayCheckout(day.checkInTime, day.checkOutTime);
      const hasWorkedValues =
        day.checkInTime !== "" ||
        day.checkOutTime !== "" ||
        Number(day.workUnits || "0") > 0 ||
        actualLiveMinutes > 0 ||
        overtimeMinutes > 0 ||
        Number(day.revenueAmount || "0") > 0;
      const values = {
        checkInAt: timestampFor(businessDate, day.checkInTime),
        checkOutAt: timestampFor(businessDate, day.checkOutTime, spansNextDay),
        spansNextDay,
        workUnits: day.workUnits || "0",
        overtimeMinutes,
        note: day.note || null,
        status: hasWorkedValues ? ("PRESENT" as const) : ("DRAFT" as const),
        actualLiveMinutes,
        revenueAmount: day.revenueAmount || "0",
      };

      try {
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
          return false;
        }

        const record = payload.data as AttendanceRecordDto;
        const summary = record.automaticViolationSummary;
        const addedCount = (summary?.createdCount ?? 0) + (summary?.reactivatedCount ?? 0);
        const automaticMessage =
          addedCount > 0
            ? `Đã tự động thêm ${addedCount} lỗi.`
            : (summary?.cancelledCount ?? 0) > 0
              ? `Đã tự động hủy ${summary!.cancelledCount} lỗi do dữ liệu đã đạt.`
              : "Đã lưu";
        replaceDay(businessDate, (latest) => ({
          ...rowFromRecord(latest, record),
          saveState: "saved",
          message: automaticMessage,
          violations: record.violations ?? latest.violations,
          activePenaltyTotal: record.activePenaltyTotal ?? latest.activePenaltyTotal,
        }));
        if (summary) {
          setAutomaticWarnings((current) => [
            ...current.filter((warning) => warning.businessDate !== businessDate),
            ...summary.warnings,
          ]);
          setDataset((current) =>
            current
              ? {
                  ...current,
                  activePenaltyTotal: summary.staffMonthActivePenaltyTotal,
                }
              : current,
          );
          if (addedCount > 0 || summary.cancelledCount > 0) {
            setBatchMessage(automaticMessage);
          }
        }
        return true;
      } catch (error) {
        replaceDay(businessDate, (latest) => ({
          ...latest,
          saveState: "error",
          message: error instanceof Error ? error.message : "Không thể lưu attendance.",
        }));
        return false;
      } finally {
        inFlight.current.delete(businessDate);
      }
    },
    [replaceDay, staffId],
  );

  const saveAll = useCallback(async (): Promise<boolean> => {
    if (batchSaving.current || inFlight.current.size > 0) {
      setBatchSaveState("error");
      setBatchMessage("Đang có dòng được lưu. Vui lòng chờ hoàn tất.");
      return false;
    }
    const targets = daysRef.current.filter(
      (day) => day.saveState === "dirty" || day.saveState === "error",
    );
    if (targets.length === 0) {
      setBatchSaveState("saved");
      setBatchMessage("Không có thay đổi cần lưu.");
      return true;
    }

    batchSaving.current = true;
    setBatchSaveState("saving");
    setBatchMessage(`Đang lưu ${targets.length} dòng…`);
    try {
      const results = await Promise.all(targets.map((day) => saveDay(day.businessDate, day)));
      const succeeded = results.filter(Boolean).length;
      const allSucceeded = succeeded === results.length;
      setBatchSaveState(allSucceeded ? "saved" : "error");
      setBatchMessage(
        allSucceeded
          ? `Đã lưu ${succeeded} dòng.`
          : `Đã lưu ${succeeded}/${results.length} dòng. Kiểm tra các dòng báo lỗi.`,
      );
      return allSucceeded;
    } finally {
      batchSaving.current = false;
    }
  }, [saveDay]);

  const loadOptions = useCallback(
    async (nextMonth: string, requestedBranchId?: string): Promise<boolean> => {
      optionsController.current?.abort();
      const controller = new AbortController();
      optionsController.current = controller;
      setOptionsLoading(true);
      setOptionsError(null);
      const parameters = new URLSearchParams({ month: nextMonth });
      if (requestedBranchId) parameters.set("branchId", requestedBranchId);
      try {
        const response = await fetch(`/api/attendance/options?${parameters.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ApiPayload;
        if (!response.ok) {
          throw new Error(errorMessage(payload, "Không thể tải bộ lọc chấm công."));
        }
        const next = payload.data as AttendanceFilterOptionsDto;
        setBranches(next.branches);
        setStaff(next.staff);
        setBranchId(next.selectedBranchId ?? "");
        setStaffId((current) =>
          next.staff.some((person) => person.id === current) ? current : (next.staff[0]?.id ?? ""),
        );
        setMonth(next.month);
        setDataset(null);
        setDays([]);
        daysRef.current = [];
        setLoadError(null);
        setPermissionDenied(false);
        setBatchSaveState("idle");
        setBatchMessage(null);
        setReconcilePreview(null);
        setReconcileError(null);
        setAutomaticWarnings([]);
        setLoading(next.staff.length > 0);
        setRefreshToken((current) => current + 1);
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false;
        setOptionsError(error instanceof Error ? error.message : "Không thể tải bộ lọc chấm công.");
        return false;
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!staffId) {
      setDataset(null);
      setDays([]);
      daysRef.current = [];
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const parameters = new URLSearchParams({ staffId, month });
    if (branchId) parameters.set("branchId", branchId);
    void fetch(`/api/attendance?${parameters.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ApiPayload;
        if (!response.ok) {
          if (response.status === 403) setPermissionDenied(true);
          throw new Error(errorMessage(payload, "Không thể tải attendance."));
        }
        const nextDataset = payload.data as AttendanceMonthDto;
        const nextDays = nextDataset.days.map(editableDay);
        setDataset(nextDataset);
        setDays(nextDays);
        daysRef.current = nextDays;
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
  }, [branchId, month, refreshToken, staffId]);

  useEffect(
    () => () => {
      optionsController.current?.abort();
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
    setBatchSaveState("idle");
    setBatchMessage(null);
  }

  function updateDurationField(
    businessDate: string,
    field: "actualLiveDuration" | "overtimeDuration",
    value: string,
  ) {
    if (!isDurationInputDraft(value)) return;

    const error = durationInputError(value);
    replaceDay(businessDate, (day) => ({
      ...day,
      [field]: value,
      saveState: "dirty",
      message: error,
      conflictRecord: null,
    }));
    setBatchSaveState("idle");
    setBatchMessage(null);
  }

  function normalizeDurationField(
    businessDate: string,
    field: "actualLiveDuration" | "overtimeDuration",
  ) {
    const day = daysRef.current.find((candidate) => candidate.businessDate === businessDate);
    if (!day) return;
    const minutes = parseDurationMinutes(day[field]);
    if (minutes === null) return;
    replaceDay(businessDate, (current) => ({
      ...current,
      [field]: formatDurationMinutes(minutes),
      message: null,
    }));
  }

  function allowContextChange(): boolean {
    if (inFlight.current.size > 0 || batchSaving.current) {
      window.alert("Dữ liệu đang được lưu. Vui lòng chờ hoàn tất rồi chuyển bộ lọc.");
      return false;
    }
    const unsettled = daysRef.current.filter((day) =>
      ["dirty", "error", "conflict"].includes(day.saveState),
    );
    if (unsettled.length === 0) return true;
    if (unsettled.some((day) => day.saveState === "conflict")) {
      window.alert("Hãy xử lý các dòng xung đột trước khi chuyển cơ sở, nhân viên hoặc tháng.");
      return false;
    }
    window.alert(
      `Còn ${unsettled.length} dòng chưa lưu. Hãy bấm “Lưu thay đổi” trước khi chuyển cơ sở, nhân viên hoặc tháng.`,
    );
    return false;
  }

  async function changeBranch(nextBranchId: string) {
    if (nextBranchId === branchId || !allowContextChange()) return;
    await loadOptions(month, nextBranchId);
  }

  async function changeMonth(nextMonth: string) {
    if (nextMonth === month || !allowContextChange()) return;
    await loadOptions(nextMonth, branchId || undefined);
  }

  async function changeStaff(nextStaffId: string) {
    if (nextStaffId === staffId || !allowContextChange()) return;
    setLoading(true);
    setLoadError(null);
    setPermissionDenied(false);
    setDataset(null);
    setDays([]);
    daysRef.current = [];
    setBatchSaveState("idle");
    setBatchMessage(null);
    setReconcilePreview(null);
    setReconcileError(null);
    setAutomaticWarnings([]);
    setStaffId(nextStaffId);
  }

  function refreshAttendance() {
    setLoading(true);
    setRefreshToken((current) => current + 1);
  }

  function openMachineImport() {
    if (machineImportBlockedReason) {
      setBatchSaveState("error");
      setBatchMessage(machineImportBlockedReason);
      return;
    }
    setBatchMessage(null);
    setMachineImportOpen(true);
  }

  function handleMachineImportComplete() {
    setBatchSaveState("saved");
    setBatchMessage("Đã import Giờ vào/Giờ ra và cập nhật bảng chấm công.");
    refreshAttendance();
  }

  async function reconcileAutomaticViolations(dryRun: boolean) {
    if (!staffId) return;
    setReconcilePending(true);
    setReconcileError(null);
    try {
      const response = await fetch("/api/attendance/automatic-violations/reconcile", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          month,
          dryRun,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Không thể tính lại lỗi tự động."));
      }
      const summary = payload.data as AutomaticViolationReconcileSummaryDto;
      setAutomaticWarnings(summary.warnings);
      if (dryRun) {
        setReconcilePreview(summary);
      } else {
        setReconcilePreview(null);
        setBatchSaveState("saved");
        setBatchMessage(
          `Đã tính lại lỗi tự động: thêm ${summary.createdCount + summary.reactivatedCount}, hủy ${summary.cancelledCount}.`,
        );
        refreshAttendance();
      }
    } catch (error) {
      setReconcileError(error instanceof Error ? error.message : "Không thể tính lại lỗi tự động.");
    } finally {
      setReconcilePending(false);
    }
  }

  function reloadConflict(businessDate: string) {
    replaceDay(businessDate, (day) =>
      day.conflictRecord ? rowFromRecord(day, day.conflictRecord) : day,
    );
  }

  function mergeConflict(businessDate: string) {
    const day = daysRef.current.find((candidate) => candidate.businessDate === businessDate);
    if (!day?.conflictRecord) return;
    const merged: EditableDay = {
      ...day,
      record: day.conflictRecord,
      saveState: "dirty",
      message: "Đã ghép thay đổi cục bộ lên phiên bản mới nhất.",
      conflictRecord: null,
    };
    replaceDay(businessDate, () => merged);
    setBatchSaveState("idle");
    setBatchMessage(null);
  }

  return (
    <section className="flex min-h-[38rem] min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 xl:min-h-0">
      <div className="flex flex-none flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Attendance & Live theo tháng</h2>
          <p className="mt-1 text-sm text-slate-500">
            Thời lượng HH:mm · check-out sớm hơn check-in tự tính là ca qua ngày · chỉ lưu khi bấm
            “Lưu thay đổi” · ngày nghiệp vụ Asia/Ho_Chi_Minh
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setView("daily")}
            type="button"
            variant={view === "daily" ? "primary" : "secondary"}
          >
            Hồ sơ ngày
          </Button>
          <Button
            onClick={() => setView("monthly")}
            type="button"
            variant={view === "monthly" ? "primary" : "secondary"}
          >
            Lưới tháng
          </Button>
        </div>
      </div>

      <div className="mt-4 grid flex-none gap-3 md:grid-cols-2 xl:grid-cols-[minmax(10rem,0.8fr)_minmax(14rem,1.2fr)_10rem_minmax(16rem,1.5fr)_auto]">
        <label className="grid gap-1 text-sm">
          Cơ sở
          <select
            aria-label="Cơ sở attendance"
            disabled={optionsLoading || branches.length === 0}
            onChange={(event) => void changeBranch(event.target.value)}
            value={branchId}
          >
            {branches.length === 0 ? <option value="">Chưa có cơ sở</option> : null}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
                {branch.isActive ? "" : " (Ngừng hoạt động)"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Nhân viên
          <select
            aria-label="Nhân viên attendance"
            disabled={optionsLoading || staff.length === 0}
            onChange={(event) => void changeStaff(event.target.value)}
            value={staffId}
          >
            {staff.length === 0 ? <option value="">Chưa có nhân viên Live</option> : null}
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.staffCode} — {person.fullName} ({person.jobTitle}) · Mã máy:{" "}
                {person.attendanceMachineCode ?? "Chưa có"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Tháng
          <input
            aria-label="Tháng attendance"
            disabled={optionsLoading}
            onChange={(event) => void changeMonth(event.target.value)}
            type="month"
            value={month}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <Button
            className="w-full whitespace-nowrap xl:w-auto"
            disabled={machineImportBlockedReason !== null}
            onClick={openMachineImport}
            title={machineImportBlockedReason ?? "Import Giờ vào/Giờ ra từ file XLSX"}
            type="button"
            variant="secondary"
          >
            Import máy chấm công
          </Button>
          <Button
            className="w-full whitespace-nowrap xl:w-auto"
            disabled={pendingCount === 0 || isAnySaving || optionsLoading || conflictCount > 0}
            onClick={() => void saveAll()}
            type="button"
          >
            {isAnySaving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-none flex-wrap items-center justify-between gap-2 text-sm">
        <div>
          <p className="text-slate-600">
            {dataset
              ? `${dataset.staff.staffCode} — ${dataset.staff.fullName} · tổng thưởng ngày ${new Intl.NumberFormat("vi-VN").format(dailyRewardTotal)} ₫ · tổng phạt tháng ${new Intl.NumberFormat("vi-VN").format(BigInt(dataset.activePenaltyTotal))} ₫`
              : staffId
                ? "Đang chuẩn bị dữ liệu…"
                : "Cơ sở này chưa có nhân viên Live trong tháng đã chọn."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Mã máy chấm công:{" "}
            <strong className="font-mono text-slate-700">
              {dataset ? (attendanceMachineCode ?? "Chưa cấu hình") : "—"}
            </strong>
            {dataset && !attendanceMachineCode ? (
              <>
                {" "}
                ·{" "}
                <a className="font-medium text-sky-700 underline" href="/staff">
                  Cập nhật trong hồ sơ nhân viên
                </a>
              </>
            ) : null}
          </p>
          <p
            aria-live="polite"
            className={`mt-1 text-xs ${
              batchSaveState === "error" ? "text-rose-700" : "text-slate-500"
            }`}
          >
            {batchMessage ??
              (conflictCount > 0
                ? `Có ${conflictCount} dòng xung đột cần xử lý.`
                : pendingCount > 0
                  ? `Còn ${pendingCount} dòng chưa lưu.`
                  : "Đã lưu tất cả thay đổi.")}
          </p>
        </div>
        {staffId ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              className="font-medium text-sky-700 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                reconcilePending || pendingCount > 0 || conflictCount > 0 || isAnySaving || !dataset
              }
              onClick={() => void reconcileAutomaticViolations(true)}
              type="button"
            >
              {reconcilePending ? "Đang tính…" : "Tính lại lỗi tự động tháng này"}
            </button>
            <a
              className="font-medium text-sky-700 underline underline-offset-4"
              href={`/api/exports/employee-error-report?staffId=${encodeURIComponent(staffId)}&month=${encodeURIComponent(month)}`}
            >
              Xuất employee error report
            </a>
          </div>
        ) : null}
      </div>

      {reconcileError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {reconcileError}
        </div>
      ) : null}
      {automaticWarnings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong className="block">
            Chưa thể tính đủ lỗi tự động cho {automaticWarnings.length} ngày
          </strong>
          <span>
            Hãy mở menu Nhân viên, thiết lập ca có hiệu lực cho các ngày:{" "}
            {[...new Set(automaticWarnings.map((warning) => warning.businessDate))]
              .map((date) => date.split("-").reverse().join("/"))
              .join(", ")}
            .
          </span>
        </div>
      ) : null}

      {optionsError ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          {optionsError}
        </div>
      ) : optionsLoading || loading ? (
        <div
          aria-live="polite"
          className="mt-4 flex min-h-0 flex-1 items-center justify-center rounded-xl bg-slate-50 p-8 text-center"
        >
          Đang tải hồ sơ tháng…
        </div>
      ) : permissionDenied ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          Bạn không có quyền xem nhân viên hoặc cơ sở này.
        </div>
      ) : loadError ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          {loadError}
        </div>
      ) : days.length === 0 ? (
        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center rounded-xl bg-slate-50 p-8 text-center text-slate-500">
          Chưa có nhân viên Live hợp lệ để nhập chấm công trong cơ sở và tháng này.
        </div>
      ) : view === "monthly" ? (
        <div
          className="attendance-grid-scroll mt-4 min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-slate-200"
          data-testid="attendance-grid-scroll"
        >
          <table className="attendance-table min-w-max text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-50 min-w-52 bg-slate-100 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.35)]">
                  Nhân viên
                </th>
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
                    className="text-center"
                    key={day.businessDate}
                    title={day.message ?? undefined}
                  >
                    <span className="block font-medium">{day.workUnits}</span>
                    {day.activePenaltyTotal !== "0" ? (
                      <span className="block text-xs font-medium text-rose-700">
                        Phạt {new Intl.NumberFormat("vi-VN").format(BigInt(day.activePenaltyTotal))}
                      </span>
                    ) : null}
                    {day.record && day.record.dailyReward.amount !== "0" ? (
                      <span className="block text-xs font-medium text-emerald-700">
                        Thưởng{" "}
                        {new Intl.NumberFormat("vi-VN").format(
                          BigInt(day.record.dailyReward.amount),
                        )}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="attendance-grid-scroll mt-4 min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-slate-200"
          data-testid="attendance-grid-scroll"
        >
          <table className="attendance-table min-w-[1280px] text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-50 w-28 min-w-28 max-w-28 bg-slate-100">
                  Ngày
                </th>
                <th className="sticky left-28 top-0 z-50 w-24 min-w-24 max-w-24 bg-slate-100 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.35)]">
                  Thứ
                </th>
                <th className="min-w-28">Check-in</th>
                <th className="min-w-28">Check-out</th>
                <th className="min-w-28">Thời lượng Live</th>
                <th className="min-w-28">Thời lượng tăng ca</th>
                <th className="min-w-24">Số công</th>
                <th className="min-w-32">{revenueLabel}</th>
                <th className="min-w-32">Thưởng ngày</th>
                <th className="w-48 min-w-40 max-w-56">Lỗi & evidence</th>
                <th>Lưu</th>
                <th className="min-w-64">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, rowIndex) => {
                const disabled = day.saveState === "saving";
                const rowBackground = rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50";
                const grid = (column: number) => ({
                  "data-grid-row": rowIndex,
                  "data-grid-col": column,
                  onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
                    moveGridFocus(event, rowIndex, column),
                });
                return (
                  <tr className={rowBackground} key={day.businessDate}>
                    <th
                      className={`sticky left-0 z-30 w-28 min-w-28 max-w-28 ${rowBackground} text-left`}
                      data-testid="sticky-business-date"
                    >
                      {displayDate(day.businessDate)}
                    </th>
                    <th
                      className={`sticky left-28 z-30 w-24 min-w-24 max-w-24 ${rowBackground} text-left font-normal shadow-[4px_0_6px_-4px_rgba(15,23,42,0.35)]`}
                      data-testid="sticky-weekday"
                    >
                      {weekdayLabels[day.dayOfWeek]}
                    </th>
                    <td>
                      <input
                        {...grid(0)}
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
                        {...grid(1)}
                        aria-label={`Check-out ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "checkOutTime", event.target.value)
                        }
                        type="time"
                        value={day.checkOutTime}
                      />
                    </td>
                    <td>
                      <input
                        {...grid(2)}
                        aria-label={`Live thực tế ${day.businessDate}`}
                        aria-invalid={
                          durationInputError(day.actualLiveDuration) ? "true" : undefined
                        }
                        className="min-w-24 font-mono"
                        disabled={disabled}
                        inputMode="numeric"
                        maxLength={5}
                        onChange={(event) =>
                          updateDurationField(
                            day.businessDate,
                            "actualLiveDuration",
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          normalizeDurationField(day.businessDate, "actualLiveDuration")
                        }
                        pattern="\d{1,2}:[0-5]\d"
                        placeholder="HH:mm"
                        title="Thời lượng HH:mm, ví dụ 02:30"
                        type="text"
                        value={day.actualLiveDuration}
                      />
                      {durationInputError(day.actualLiveDuration) ? (
                        <span className="mt-1 block max-w-32 whitespace-normal break-words text-xs text-rose-700 [overflow-wrap:anywhere]">
                          {durationInputError(day.actualLiveDuration)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        {...grid(3)}
                        aria-label={`Tăng ca ${day.businessDate}`}
                        aria-invalid={durationInputError(day.overtimeDuration) ? "true" : undefined}
                        className="min-w-24 font-mono"
                        disabled={disabled}
                        inputMode="numeric"
                        maxLength={5}
                        onChange={(event) =>
                          updateDurationField(
                            day.businessDate,
                            "overtimeDuration",
                            event.target.value,
                          )
                        }
                        onBlur={() => normalizeDurationField(day.businessDate, "overtimeDuration")}
                        pattern="\d{1,2}:[0-5]\d"
                        placeholder="HH:mm"
                        title="Thời lượng HH:mm, ví dụ 01:30"
                        type="text"
                        value={day.overtimeDuration}
                      />
                      {durationInputError(day.overtimeDuration) ? (
                        <span className="mt-1 block max-w-32 whitespace-normal break-words text-xs text-rose-700 [overflow-wrap:anywhere]">
                          {durationInputError(day.overtimeDuration)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        {...grid(4)}
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
                        {...grid(5)}
                        aria-label={`${revenueLabel} ${day.businessDate}`}
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
                    <td className="min-w-32">
                      <span className="font-semibold text-emerald-700">
                        {new Intl.NumberFormat("vi-VN").format(
                          BigInt(day.record?.dailyReward.amount ?? "0"),
                        )}
                        đ
                      </span>
                      {day.record?.dailyReward.matchedThreshold ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          Mốc{" "}
                          {new Intl.NumberFormat("vi-VN").format(
                            BigInt(day.record.dailyReward.matchedThreshold),
                          )}{" "}
                          xu
                        </span>
                      ) : (
                        <span className="mt-1 block text-xs text-slate-400">
                          {day.record?.dailyReward.status === "NO_ACTIVE_RULE"
                            ? "Chưa có rule"
                            : "Chưa đạt mốc"}
                        </span>
                      )}
                    </td>
                    <td className="w-48 min-w-40 max-w-56 align-top">
                      <AttendanceViolations
                        activePenaltyTotal={day.activePenaltyTotal}
                        attendanceId={day.record?.id ?? null}
                        businessDate={day.businessDate}
                        canOverrideAmount={canOverridePenalty}
                        disabledReason={violationInteractionBlockedReason}
                        onChanged={refreshAttendance}
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
                        {saveLabels[day.saveState]}
                      </span>
                      {day.message ? (
                        <span className="mt-1 block max-w-52 whitespace-normal break-words text-xs [overflow-wrap:anywhere]">
                          {day.message}
                        </span>
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
                          <button
                            className="text-sky-700 underline"
                            onClick={() => mergeConflict(day.businessDate)}
                            type="button"
                          >
                            Ghép thay đổi
                          </button>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        {...grid(6)}
                        aria-label={`Ghi chú ${day.businessDate}`}
                        disabled={disabled}
                        onChange={(event) =>
                          updateField(day.businessDate, "note", event.target.value)
                        }
                        value={day.note}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AttendanceMachineImportDialog
        attendanceMachineCode={attendanceMachineCode}
        branchId={branchId}
        branchName={
          selectedBranch ? `${selectedBranch.code} — ${selectedBranch.name}` : "Chưa chọn cơ sở"
        }
        month={month}
        onClose={() => setMachineImportOpen(false)}
        onImported={handleMachineImportComplete}
        open={machineImportOpen}
        staffId={staffId}
        staffName={
          selectedStaff
            ? `${selectedStaff.staffCode} — ${selectedStaff.fullName}`
            : "Chưa chọn nhân viên"
        }
      />

      {reconcilePreview ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/40 p-3"
          role="presentation"
        >
          <div
            aria-label="Xác nhận tính lại lỗi tự động"
            aria-modal="true"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
            role="dialog"
          >
            <div className="border-b border-slate-200 p-5">
              <h3 className="text-lg font-semibold">Tính lại lỗi tự động tháng {month}</h3>
              <p className="mt-1 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">
                Xem trước cho {dataset?.staff.fullName}. Dữ liệu chỉ thay đổi sau khi bạn xác nhận.
              </p>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <div className="rounded-xl bg-rose-50 p-4">
                <span className="block text-sm text-rose-700">Lỗi sẽ thêm/kích hoạt lại</span>
                <strong className="mt-1 block text-2xl text-rose-900">
                  {reconcilePreview.createdCount + reconcilePreview.reactivatedCount}
                </strong>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4">
                <span className="block text-sm text-emerald-700">Lỗi sẽ hủy</span>
                <strong className="mt-1 block text-2xl text-emerald-900">
                  {reconcilePreview.cancelledCount}
                </strong>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2">
                <span className="block text-sm text-slate-600">Không thay đổi</span>
                <strong className="mt-1 block text-xl text-slate-900">
                  {reconcilePreview.unchangedCount}
                </strong>
              </div>
              {reconcilePreview.missingScheduleCount > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:col-span-2">
                  <strong className="block text-amber-900">
                    Thiếu ca làm: {reconcilePreview.missingScheduleCount} ngày
                  </strong>
                  <span className="mt-1 block text-sm text-amber-800">
                    Thiết lập ca hiệu lực trong menu Nhân viên trước khi áp dụng để tránh bỏ sót lỗi
                    đi muộn hoặc thiếu Live.
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-4">
              <Button
                disabled={reconcilePending}
                onClick={() => setReconcilePreview(null)}
                type="button"
                variant="secondary"
              >
                Đóng
              </Button>
              <Button
                disabled={reconcilePending}
                onClick={() => void reconcileAutomaticViolations(false)}
                type="button"
              >
                {reconcilePending ? "Đang áp dụng…" : "Xác nhận áp dụng"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
