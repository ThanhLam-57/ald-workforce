"use client";

import type {
  AttendanceMachineImportHistoryItemDto,
  AttendanceMachineImportJobDto,
  AttendanceMachineImportPreviewDto,
  AttendanceMachineImportRowStatus,
} from "@ald/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  attendanceMachineAttemptKey,
  attendanceMachineImportHistoryPath,
  attendanceMachineUploadPath,
} from "./attendance-machine-import-client";
import {
  attendanceMachineImportSelectableRowKeys,
  isAttendanceMachineImportRowSelectable,
} from "./attendance-machine-import-view";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_SIZE = 20 * 1_024 * 1_024;

type AttendanceMachineImportDialogProps = Readonly<{
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
  branchId: string;
  branchName: string;
  staffId: string;
  staffName: string;
  month: string;
  attendanceMachineCode: string | null;
}>;

type PresignResult = Readonly<{
  job: AttendanceMachineImportJobDto;
  target: AttendanceMachineImportPreviewDto["target"];
  duplicate: boolean;
  unfinishedAttemptExists: boolean;
}>;

type BusyStep = "checksum" | "upload" | "preview" | "commit" | null;

const statusLabels: Readonly<Record<AttendanceMachineImportRowStatus, string>> = {
  CREATE: "Tạo ngày mới",
  UPDATE: "Cập nhật",
  UNCHANGED: "Không thay đổi",
  SKIP_CODE_MISMATCH: "Bỏ qua: khác mã",
  SKIP_OUTSIDE_MONTH: "Bỏ qua: ngoài tháng",
  SKIP_EMPTY_TIME: "Bỏ qua: không có giờ",
  DUPLICATE: "Trùng ngày và mã",
  ERROR: "Lỗi",
};

const statusClasses: Readonly<Record<AttendanceMachineImportRowStatus, string>> = {
  CREATE: "bg-emerald-100 text-emerald-800",
  UPDATE: "bg-sky-100 text-sky-800",
  UNCHANGED: "bg-slate-100 text-slate-700",
  SKIP_CODE_MISMATCH: "bg-amber-100 text-amber-800",
  SKIP_OUTSIDE_MONTH: "bg-amber-100 text-amber-800",
  SKIP_EMPTY_TIME: "bg-amber-100 text-amber-800",
  DUPLICATE: "bg-rose-100 text-rose-800",
  ERROR: "bg-rose-100 text-rose-800",
};

const jobStatusLabels: Readonly<Record<AttendanceMachineImportJobDto["status"], string>> = {
  PENDING_UPLOAD: "Chờ tải file",
  UPLOADED: "Đã tải file",
  VALIDATING: "Đang kiểm tra",
  VALIDATED: "Đã xem trước",
  COMMITTING: "Đang ghi dữ liệu",
  SUCCEEDED: "Đã import",
  FAILED: "Thất bại",
  EXPIRED: "Đã hết hạn",
  SUPERSEDED: "Đã được thay thế",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.message === "string" ? payload.error.message : null;
}

class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;

  constructor(
    message: string,
    status: number,
    code: string | null,
    details: Readonly<Record<string, unknown>> | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        response.ok
          ? "Máy chủ trả về dữ liệu không hợp lệ."
          : `Yêu cầu thất bại (${response.status}).`,
      );
    }
  }
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    throw new ApiError(
      apiErrorMessage(payload) ?? `Yêu cầu thất bại (${response.status}).`,
      response.status,
      errorPayload && typeof errorPayload.code === "string" ? errorPayload.code : null,
      errorPayload && isRecord(errorPayload.details) ? errorPayload.details : null,
    );
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw new Error("Máy chủ không trả về dữ liệu.");
  }
  return payload.data as T;
}

async function checksumBase64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function busyLabel(step: BusyStep): string {
  switch (step) {
    case "checksum":
      return "Đang kiểm tra file...";
    case "upload":
      return "Đang tải file lên...";
    case "preview":
      return "Đang đối chiếu dữ liệu...";
    case "commit":
      return "Đang ghi giờ chấm công...";
    default:
      return "";
  }
}

type AttendanceMachineImportDialogContentProps = Omit<AttendanceMachineImportDialogProps, "open">;

export function AttendanceMachineImportDialog(props: AttendanceMachineImportDialogProps) {
  const { open, ...contentProps } = props;
  return open ? <AttendanceMachineImportDialogContent {...contentProps} /> : null;
}

function AttendanceMachineImportDialogContent({
  onClose,
  onImported,
  branchId,
  branchName,
  staffId,
  staffName,
  month,
  attendanceMachineCode,
}: AttendanceMachineImportDialogContentProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attemptIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<AttendanceMachineImportJobDto | null>(null);
  const [preview, setPreview] = useState<AttendanceMachineImportPreviewDto | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<ReadonlySet<string>>(new Set());
  const [busyStep, setBusyStep] = useState<BusyStep>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [unfinishedAttemptExists, setUnfinishedAttemptExists] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly AttendanceMachineImportHistoryItemDto[]>([]);

  const reset = useCallback(() => {
    setFile(null);
    setJob(null);
    setPreview(null);
    setSelectedRowKeys(new Set());
    setBusyStep(null);
    setError(null);
    setNotice(null);
    setPreviewStale(false);
    setUnfinishedAttemptExists(false);
    setHistoryOpen(false);
    setHistoryLoading(false);
    setHistoryError(null);
    setHistory([]);
    attemptIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const closeDialog = useCallback(() => {
    if (busyStep) return;
    reset();
    onClose();
  }, [busyStep, onClose, reset]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyStep) {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busyStep, closeDialog]);

  function validateInput(): File | null {
    setError(null);
    setNotice(null);
    if (!attendanceMachineCode?.trim()) {
      setError("Nhân viên chưa có Mã máy chấm công trong cơ sở và tháng đang chọn.");
      return null;
    }
    if (!file) {
      setError("Hãy chọn file XLSX từ máy chấm công.");
      return null;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Chỉ hỗ trợ file XLSX.");
      return null;
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      setError("File XLSX phải có dung lượng lớn hơn 0 và không quá 20 MB.");
      return null;
    }
    return file;
  }

  async function loadPreview(jobId: string) {
    setBusyStep("preview");
    const result = await api<AttendanceMachineImportPreviewDto>(
      `/api/attendance/machine-imports/${jobId}/preview`,
      { method: "POST" },
    );
    setPreview(result);
    setSelectedRowKeys(new Set(attendanceMachineImportSelectableRowKeys(result.rows)));
    setUnfinishedAttemptExists(false);
    setNotice(
      result.summary.matchedRows === 0
        ? `Không tìm thấy dữ liệu phù hợp với mã máy chấm công ${
            attendanceMachineCode ?? ""
          } trong tháng ${formatMonth(month)}.`
        : result.canCommit
          ? "Đã đối chiếu xong. Hãy kiểm tra các dòng trước khi xác nhận import."
          : result.summary.errorRows > 0
            ? "File còn dòng lỗi. Hãy sửa file rồi tải lại trước khi import."
            : "Không có giờ chấm công mới cần ghi.",
    );
  }

  function startNewAttempt(): void {
    attemptIdRef.current = crypto.randomUUID();
    setJob(null);
    setPreview(null);
    setSelectedRowKeys(new Set());
    setError(null);
    setNotice(null);
    setPreviewStale(false);
    setUnfinishedAttemptExists(false);
  }

  function stageErrorMessage(stage: Exclude<BusyStep, null>, cause: unknown): string {
    if (cause instanceof ApiError) {
      return cause.message;
    }
    if (stage === "upload") {
      return "Không thể tải file lên hệ thống. Hãy kiểm tra kết nối rồi bấm Thử lại.";
    }
    if (stage === "preview") {
      return "Không thể tạo bản xem trước. Vui lòng thử lại.";
    }
    if (stage === "checksum") {
      return "Không thể kiểm tra file XLSX đã chọn.";
    }
    return cause instanceof Error ? cause.message : "Không thể chuẩn bị bản xem trước.";
  }

  async function loadHistory(): Promise<void> {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(
        await api<readonly AttendanceMachineImportHistoryItemDto[]>(
          attendanceMachineImportHistoryPath({ branchId, staffId, month }),
        ),
      );
    } catch (cause) {
      setHistoryError(
        cause instanceof Error ? cause.message : "Không thể tải lịch sử nhập dữ liệu.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function preparePreview() {
    const selectedFile = validateInput();
    if (!selectedFile) return;
    let stage: Exclude<BusyStep, null> = "checksum";
    setBusyStep("checksum");
    setPreviewStale(false);
    try {
      const checksumSha256 = await checksumBase64(selectedFile);
      const attemptId = attemptIdRef.current ?? crypto.randomUUID();
      attemptIdRef.current = attemptId;
      const created = await api<PresignResult>("/api/attendance/machine-imports/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          branchId,
          month,
          attemptId,
          idempotencyKey: attendanceMachineAttemptKey(attemptId),
          originalFileName: selectedFile.name,
          mimeType: XLSX_MIME,
          sizeBytes: selectedFile.size,
          checksumSha256,
        }),
      });
      let currentJob = created.job;
      setJob(currentJob);
      setUnfinishedAttemptExists(created.unfinishedAttemptExists);

      if (currentJob.status === "PENDING_UPLOAD") {
        stage = "upload";
        setBusyStep("upload");
        currentJob = await api<AttendanceMachineImportJobDto>(
          attendanceMachineUploadPath(currentJob.id),
          {
            method: "PUT",
            headers: { "Content-Type": XLSX_MIME },
            body: selectedFile,
          },
        );
        setJob(currentJob);
      }

      if (currentJob.status === "SUCCEEDED") {
        setNotice(
          `File này đã được import trước đó (${currentJob.committedRows.toLocaleString(
            "vi-VN",
          )} dòng). Dữ liệu sẽ không được ghi lặp.`,
        );
        return;
      }
      if (currentJob.status === "VALIDATING" || currentJob.status === "COMMITTING") {
        setNotice("Lượt import đang được hệ thống xử lý. Vui lòng thử lại sau.");
        return;
      }
      if (currentJob.status === "EXPIRED" || currentJob.status === "SUPERSEDED") {
        throw new Error("Lượt import đã hết hạn hoặc đã được thay thế. Hãy tạo lượt import mới.");
      }
      if (!["UPLOADED", "VALIDATED"].includes(currentJob.status)) {
        throw new Error(
          currentJob.errorMessage ??
            "File chưa ở trạng thái sẵn sàng để đối chiếu. Hãy chọn lại file.",
        );
      }
      stage = "preview";
      await loadPreview(currentJob.id);
    } catch (cause) {
      const stale = cause instanceof ApiError && cause.details?.code === "IMPORT_PREVIEW_STALE";
      setPreviewStale(stale);
      if (stage === "upload") {
        attemptIdRef.current = null;
        setJob(null);
        setPreview(null);
        setSelectedRowKeys(new Set());
        setUnfinishedAttemptExists(false);
      }
      setError(stageErrorMessage(stage, cause));
    } finally {
      setBusyStep(null);
      if (historyOpen) void loadHistory();
    }
  }

  async function commitImport() {
    if (!job || !preview?.canCommit || selectedRowKeys.size === 0) {
      setError("Bản xem trước chưa thể import.");
      return;
    }
    setBusyStep("commit");
    setError(null);
    setNotice(null);
    try {
      const committed = await api<AttendanceMachineImportJobDto>(
        `/api/attendance/machine-imports/${job.id}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            selectedRowKeys: [...selectedRowKeys],
          }),
        },
      );
      if (committed.status !== "SUCCEEDED") {
        throw new Error(committed.errorMessage ?? "Import chưa hoàn tất.");
      }
      await onImported();
      reset();
      onClose();
    } catch (cause) {
      const stale = cause instanceof ApiError && cause.details?.code === "IMPORT_PREVIEW_STALE";
      setPreviewStale(stale);
      setError(
        stale
          ? "Dữ liệu chấm công đã thay đổi sau khi xem trước. Hãy tạo lại bản xem trước."
          : cause instanceof Error
            ? cause.message
            : "Không thể import giờ chấm công.",
      );
    } finally {
      setBusyStep(null);
    }
  }

  const selectableRows =
    preview?.rows.filter((row) => isAttendanceMachineImportRowSelectable(row.status)) ?? [];
  const allSelectableRowsChecked =
    selectableRows.length > 0 && selectableRows.every((row) => selectedRowKeys.has(row.rowKey));

  function toggleRow(rowKey: string, checked: boolean): void {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }

  function toggleAllRows(checked: boolean): void {
    setSelectedRowKeys(checked ? new Set(selectableRows.map((row) => row.rowKey)) : new Set());
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-slate-950/55 p-2 sm:p-4"
      role="presentation"
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex max-h-[94dvh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold" id={titleId}>
              Import dữ liệu máy chấm công
            </h2>
            <p
              className="mt-1 break-words text-sm text-slate-600 [overflow-wrap:anywhere]"
              id={descriptionId}
            >
              Chỉ đối chiếu file với nhân viên đang chọn theo Mã Nhân Viên và ngày trong tháng.
            </p>
          </div>
          <button
            aria-label="Đóng hộp thoại import"
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(busyStep)}
            onClick={closeDialog}
            type="button"
          >
            Đóng
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <section
            aria-label="Nhân viên nhận dữ liệu"
            className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cơ sở</p>
              <p className="break-words font-semibold [overflow-wrap:anywhere]">{branchName}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Nhân viên
              </p>
              <p className="break-words font-semibold [overflow-wrap:anywhere]">{staffName}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Mã máy chấm công
              </p>
              <p className="font-mono font-semibold">
                {attendanceMachineCode?.trim() || "Chưa có"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tháng</p>
              <p className="font-semibold">{formatMonth(month)}</p>
            </div>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              File máy chấm công (.xlsx, tối đa 20 MB)
              <input
                accept={`.xlsx,${XLSX_MIME}`}
                className="block min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:font-medium"
                disabled={Boolean(busyStep)}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  attemptIdRef.current = crypto.randomUUID();
                  setJob(null);
                  setPreview(null);
                  setError(null);
                  setNotice(null);
                  setPreviewStale(false);
                  setUnfinishedAttemptExists(false);
                }}
                ref={fileInputRef}
                type="file"
              />
              {file ? (
                <span className="break-all text-xs font-normal text-slate-500">
                  {file.name} ·{" "}
                  {(file.size / 1_024).toLocaleString("vi-VN", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  KB
                </span>
              ) : null}
            </label>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={Boolean(busyStep) || !attendanceMachineCode}
              onClick={() => {
                if (previewStale) startNewAttempt();
                void preparePreview();
              }}
              type="button"
            >
              {busyStep && busyStep !== "commit"
                ? busyLabel(busyStep)
                : error
                  ? previewStale
                    ? "Xem trước lại"
                    : "Thử lại"
                  : "Tải lên và xem trước"}
            </button>
            <button
              aria-expanded={historyOpen}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={historyLoading}
              onClick={() => {
                if (historyOpen) {
                  setHistoryOpen(false);
                  return;
                }
                setHistoryOpen(true);
                void loadHistory();
              }}
              type="button"
            >
              {historyLoading
                ? "Đang tải lịch sử..."
                : historyOpen
                  ? "Ẩn lịch sử nhập"
                  : "Xem lịch sử nhập"}
            </button>
            {job && !busyStep ? (
              <button
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  startNewAttempt();
                  setNotice("Đã tạo lượt nhập mới. Bấm Tải lên và xem trước để tiếp tục.");
                }}
                type="button"
              >
                Tạo lượt nhập mới
              </button>
            ) : null}
            {job ? (
              <span className="break-all text-xs text-slate-500">
                Mã lượt import: {job.id} · {job.status}
              </span>
            ) : null}
          </div>

          <div aria-live="polite" className="mt-3">
            {unfinishedAttemptExists ? (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Có một lượt nhập chưa hoàn tất trước đó. Bạn vẫn có thể tiếp tục bằng lượt nhập mới
                này.
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                {notice}
              </p>
            ) : null}
          </div>

          {historyOpen ? (
            <section
              aria-labelledby={`${titleId}-history`}
              className="mt-4 rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold" id={`${titleId}-history`}>
                    Lịch sử nhập của hồ sơ đang chọn
                  </h3>
                  <p className="text-xs text-slate-500">
                    Chỉ hiển thị các lượt của đúng cơ sở, nhân viên và tháng này.
                  </p>
                </div>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={historyLoading}
                  onClick={() => void loadHistory()}
                  type="button"
                >
                  Làm mới
                </button>
              </div>

              {historyError ? (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {historyError}
                </p>
              ) : historyLoading && history.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Đang tải lịch sử nhập...</p>
              ) : history.length === 0 ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Chưa có lượt nhập nào cho hồ sơ và tháng này.
                </p>
              ) : (
                <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-[1050px] table-fixed text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        <th className="w-64 px-3 py-2">File</th>
                        <th className="w-40 px-3 py-2">Trạng thái</th>
                        <th className="w-40 px-3 py-2">Tạo lúc</th>
                        <th className="w-40 px-3 py-2">Hoàn tất</th>
                        <th className="w-40 px-3 py-2">Số dòng</th>
                        <th className="w-32 px-3 py-2">Người thực hiện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((item) => (
                        <tr className="border-t border-slate-100 align-top" key={item.id}>
                          <td className="px-3 py-2">
                            <span className="block break-all font-medium">
                              {item.originalFileName}
                            </span>
                            <span className="block break-all font-mono text-[10px] text-slate-400">
                              {item.id}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex max-w-full whitespace-normal rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                              {jobStatusLabels[item.status]}
                            </span>
                            {item.expiredAt ? (
                              <span className="mt-1 block text-[10px] text-slate-500">
                                Hết hạn: {formatTimestamp(item.expiredAt)}
                              </span>
                            ) : null}
                            {item.supersededAt ? (
                              <span className="mt-1 block text-[10px] text-slate-500">
                                Thay thế: {formatTimestamp(item.supersededAt)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{formatTimestamp(item.createdAt)}</td>
                          <td className="px-3 py-2">
                            {formatTimestamp(
                              item.committedAt ?? item.validatedAt ?? item.uploadedAt,
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="block">
                              Tổng: {item.totalRows.toLocaleString("vi-VN")}
                            </span>
                            <span className="block text-emerald-700">
                              Hợp lệ: {item.validRows.toLocaleString("vi-VN")}
                            </span>
                            <span className="block text-rose-700">
                              Lỗi: {item.errorRows.toLocaleString("vi-VN")}
                            </span>
                            <span className="block text-sky-700">
                              Đã ghi: {item.committedRows.toLocaleString("vi-VN")}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {item.ownedByCurrentUser ? "Lượt của bạn" : "Người khác"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {preview ? (
            <section aria-labelledby={`${titleId}-preview`} className="mt-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold" id={`${titleId}-preview`}>
                    Kết quả đối chiếu
                  </h3>
                  <p className="text-xs text-slate-500">
                    Giờ hiện tại được giữ nguyên nếu ô tương ứng trong file để trống.
                  </p>
                </div>
                {preview.truncated ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    Bảng chỉ hiển thị một phần dữ liệu
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {[
                  ["Tổng dòng", preview.summary.totalRows],
                  ["Khớp nhân viên", preview.summary.matchedRows],
                  ["Tạo mới", preview.summary.createRows],
                  ["Cập nhật", preview.summary.updateRows],
                  ["Không đổi", preview.summary.unchangedRows],
                  ["Bỏ qua", preview.summary.skippedRows],
                  ["Lỗi", preview.summary.errorRows],
                ].map(([label, value]) => (
                  <div className="rounded-lg border border-slate-200 p-2" key={String(label)}>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-lg font-semibold">{Number(value).toLocaleString("vi-VN")}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700">
                Đã chọn {selectedRowKeys.size.toLocaleString("vi-VN")}/
                {selectableRows.length.toLocaleString("vi-VN")} ngày có thể import. Dòng lỗi hoặc bỏ
                qua sẽ không được ghi.
              </p>

              <div className="mt-3 max-h-[42dvh] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-[1440px] table-fixed text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="w-16 px-3 py-2 text-center">
                        <input
                          aria-label="Chọn tất cả dòng có thể import"
                          checked={allSelectableRowsChecked}
                          className="h-4 w-4 accent-sky-700"
                          disabled={selectableRows.length === 0 || Boolean(busyStep)}
                          onChange={(event) => toggleAllRows(event.target.checked)}
                          type="checkbox"
                        />
                      </th>
                      <th className="w-24 px-3 py-2">Dòng</th>
                      <th className="w-28 px-3 py-2">Ngày</th>
                      <th className="w-36 px-3 py-2">Mã trong file</th>
                      <th className="w-32 px-3 py-2">Check-in hiện tại</th>
                      <th className="w-32 px-3 py-2">Check-in trong file</th>
                      <th className="w-32 px-3 py-2">Check-out hiện tại</th>
                      <th className="w-32 px-3 py-2">Check-out trong file</th>
                      <th className="w-40 px-3 py-2">Kết quả</th>
                      <th className="w-64 px-3 py-2">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr
                        className={`border-t border-slate-100 align-top ${
                          isAttendanceMachineImportRowSelectable(row.status) &&
                          !selectedRowKeys.has(row.rowKey)
                            ? "bg-slate-50 text-slate-500"
                            : ""
                        }`}
                        key={row.rowKey}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            aria-label={`Chọn import ngày ${
                              formatDate(row.businessDate) || `dòng ${row.rowNumber}`
                            }`}
                            checked={
                              isAttendanceMachineImportRowSelectable(row.status) &&
                              selectedRowKeys.has(row.rowKey)
                            }
                            className="h-4 w-4 accent-sky-700"
                            disabled={
                              !isAttendanceMachineImportRowSelectable(row.status) ||
                              Boolean(busyStep)
                            }
                            onChange={(event) => toggleRow(row.rowKey, event.target.checked)}
                            title={
                              isAttendanceMachineImportRowSelectable(row.status)
                                ? "Chọn hoặc bỏ dòng này khỏi lần import"
                                : "Dòng này không đủ điều kiện import"
                            }
                            type="checkbox"
                          />
                        </td>
                        <td className="break-words px-3 py-2">
                          <span className="block font-medium">{row.rowNumber}</span>
                          <span className="block text-[11px] text-slate-500">{row.sheetName}</span>
                        </td>
                        <td className="px-3 py-2">{formatDate(row.businessDate)}</td>
                        <td className="break-all px-3 py-2 font-mono">{row.machineCode || "—"}</td>
                        <td className="px-3 py-2 font-mono">{row.currentCheckInTime ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{row.fileCheckInTime ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{row.currentCheckOutTime ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{row.fileCheckOutTime ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex max-w-full whitespace-normal rounded-full px-2 py-1 font-semibold ${statusClasses[row.status]}`}
                          >
                            {statusLabels[row.status]}
                          </span>
                        </td>
                        <td className="whitespace-normal break-words px-3 py-2 [overflow-wrap:anywhere]">
                          {row.message ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          <p className="min-w-0 flex-1 text-xs text-slate-500">
            Import chỉ cập nhật Check-in/Check-out; không ghi đè công, Live, xu, tăng ca, ghi chú
            hoặc lỗi thủ công.
          </p>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={Boolean(busyStep)}
              onClick={closeDialog}
              type="button"
            >
              Hủy
            </button>
            <button
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={Boolean(busyStep) || !preview?.canCommit || selectedRowKeys.size === 0}
              onClick={() => void commitImport()}
              type="button"
            >
              {busyStep === "commit" ? busyLabel(busyStep) : "Xác nhận import"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
