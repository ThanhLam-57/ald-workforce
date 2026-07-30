"use client";

import type {
  AttendanceMachineImportJobDto,
  AttendanceMachineImportPreviewDto,
  AttendanceMachineImportRowStatus,
} from "@ald/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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
  upload: Readonly<{
    url: string;
    headers: Readonly<Record<string, string>>;
  }> | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.message === "string" ? payload.error.message : null;
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
    throw new Error(apiErrorMessage(payload) ?? `Yêu cầu thất bại (${response.status}).`);
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
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<AttendanceMachineImportJobDto | null>(null);
  const [preview, setPreview] = useState<AttendanceMachineImportPreviewDto | null>(null);
  const [busyStep, setBusyStep] = useState<BusyStep>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setJob(null);
    setPreview(null);
    setBusyStep(null);
    setError(null);
    setNotice(null);
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

  async function preparePreview() {
    const selectedFile = validateInput();
    if (!selectedFile) return;
    setBusyStep("checksum");
    try {
      const checksumSha256 = await checksumBase64(selectedFile);
      const created = await api<PresignResult>("/api/attendance/machine-imports/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          branchId,
          month,
          idempotencyKey: `attendance-machine:${branchId}:${staffId}:${month}:${checksumSha256}`,
          originalFileName: selectedFile.name,
          mimeType: XLSX_MIME,
          sizeBytes: selectedFile.size,
          checksumSha256,
        }),
      });
      let currentJob = created.job;
      setJob(currentJob);

      if (created.upload) {
        setBusyStep("upload");
        const uploadResponse = await fetch(created.upload.url, {
          method: "PUT",
          headers: { ...created.upload.headers },
          body: selectedFile,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Tải file lên kho riêng tư thất bại (${uploadResponse.status}).`);
        }
        currentJob = await api<AttendanceMachineImportJobDto>(
          `/api/attendance/machine-imports/${currentJob.id}/complete`,
          { method: "POST" },
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
        setNotice("File trùng đang được hệ thống xử lý. Vui lòng thử lại sau.");
        return;
      }
      if (!["UPLOADED", "VALIDATED"].includes(currentJob.status)) {
        throw new Error(
          currentJob.errorMessage ??
            "File chưa ở trạng thái sẵn sàng để đối chiếu. Hãy chọn lại file.",
        );
      }
      await loadPreview(currentJob.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể chuẩn bị bản xem trước.");
    } finally {
      setBusyStep(null);
    }
  }

  async function commitImport() {
    if (!job || !preview?.canCommit) {
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
          body: JSON.stringify({ confirm: true }),
        },
      );
      if (committed.status !== "SUCCEEDED") {
        throw new Error(committed.errorMessage ?? "Import chưa hoàn tất.");
      }
      await onImported();
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể import giờ chấm công.");
    } finally {
      setBusyStep(null);
    }
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
                  setJob(null);
                  setPreview(null);
                  setError(null);
                  setNotice(null);
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
              onClick={() => void preparePreview()}
              type="button"
            >
              {busyStep && busyStep !== "commit" ? busyLabel(busyStep) : "Tải lên và xem trước"}
            </button>
            {job ? (
              <span className="break-all text-xs text-slate-500">
                Mã lượt import: {job.id} · {job.status}
              </span>
            ) : null}
          </div>

          <div aria-live="polite" className="mt-3">
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

              <div className="mt-3 max-h-[42dvh] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-[1380px] table-fixed text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                    <tr>
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
                        className="border-t border-slate-100 align-top"
                        key={`${row.sheetName}:${row.rowNumber}`}
                      >
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
              disabled={Boolean(busyStep) || !preview?.canCommit}
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
