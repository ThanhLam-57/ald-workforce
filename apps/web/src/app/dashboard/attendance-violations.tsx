"use client";

import type {
  PenaltyItemDto,
  PenaltyRuleVersionDto,
  ViolationDto,
  ViolationPreviewDto,
} from "@ald/contracts";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { activeViolationBadges } from "./attendance-violations-view";

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

type EvidencePresignData = Readonly<{
  evidence: Readonly<{ id: string; version: number }>;
  upload: Readonly<{
    url: string;
    headers: Readonly<Record<string, string>>;
  }>;
}>;

const EVIDENCE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const EVIDENCE_UPLOAD_TIMEOUT_MS = 120_000;
const EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

async function apiPayload(response: Response): Promise<ApiPayload> {
  const body = await response.text();
  if (!body.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as ApiPayload) : {};
  } catch {
    return {};
  }
}

function responseErrorMessage(response: Response, payload: ApiPayload, fallback: string): string {
  const message = payload.error?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : `${fallback} (HTTP ${response.status}).`;
}

function validEvidencePresignData(value: unknown): value is EvidencePresignData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    evidence?: { id?: unknown; version?: unknown };
    upload?: { url?: unknown; headers?: unknown };
  };
  return (
    typeof candidate.evidence?.id === "string" &&
    typeof candidate.evidence.version === "number" &&
    typeof candidate.upload?.url === "string" &&
    typeof candidate.upload.headers === "object" &&
    candidate.upload.headers !== null
  );
}

function isReadyEvidence(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && "status" in value && value.status === "READY"
  );
}

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}

function isManualPenaltyItem(item: PenaltyItemDto): boolean {
  const condition = item.metadata?.automaticCondition;
  return (
    typeof condition !== "object" ||
    condition === null ||
    !("type" in condition) ||
    condition.type === "MANUAL"
  );
}

async function sha256Base64(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function assertSameOriginEvidenceUploadUrl(url: string): void {
  if (url.startsWith("/api/evidence/") && !url.startsWith("//")) return;
  throw new Error("API không trả về đường dẫn tải evidence nội bộ hợp lệ.");
}

async function putEvidence(url: string, headers: Readonly<Record<string, string>>, file: File) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EVIDENCE_UPLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "PUT",
      cache: "no-store",
      headers,
      body: file,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function EvidenceThumbnail({ evidenceId, name }: Readonly<{ evidenceId: string; name: string }>) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const response = await fetch(`/api/evidence/${encodeURIComponent(evidenceId)}/view`, {
        cache: "no-store",
      });
      const payload = await apiPayload(response);
      const data = payload.data;
      if (
        !response.ok ||
        typeof data !== "object" ||
        data === null ||
        !("url" in data) ||
        typeof data.url !== "string"
      ) {
        setError(true);
        return;
      }
      setUrl(data.url);
    } catch {
      setError(true);
    }
  }

  return url ? (
    // Signed URL is short-lived and only returned after server authorization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={name}
      className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
      src={url}
    />
  ) : (
    <button
      className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 p-1 text-center text-xs text-sky-700"
      disabled={error}
      onClick={() => void load()}
      type="button"
    >
      {error ? "Không thể xem" : "Xem ảnh"}
    </button>
  );
}

export function AttendanceViolations({
  attendanceId,
  businessDate,
  violations,
  activePenaltyTotal,
  canOverrideAmount,
  disabledReason = null,
  onChanged,
}: Readonly<{
  attendanceId: string | null;
  businessDate: string;
  violations: readonly ViolationDto[];
  activePenaltyTotal: string;
  canOverrideAmount: boolean;
  disabledReason?: string | null;
  onChanged: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<readonly PenaltyItemDto[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<ViolationPreviewDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const selectedItem = items.find((item) => item.id === selectedItemId);
  const activeViolations = activeViolationBadges(violations);
  const activeViolationCount = activeViolations.length;

  function resetViolationForm() {
    setEditing(false);
    setItems([]);
    setSelectedItemId("");
    setDetail("");
    setNote("");
    setAmountOverride("");
    setOverrideReason("");
    setPreview(null);
  }

  function openPanel() {
    resetViolationForm();
    setMessage(null);
    setPanelOpen(true);
  }

  function closePanel() {
    resetViolationForm();
    setMessage(null);
    setPanelOpen(false);
  }

  async function loadPreview(penaltyItemId: string) {
    if (!attendanceId || !penaltyItemId) {
      setPreview(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/violations/preview?attendanceId=${encodeURIComponent(attendanceId)}&penaltyItemId=${encodeURIComponent(penaltyItemId)}`,
        { cache: "no-store" },
      );
      const payload = await apiPayload(response);
      if (!response.ok) {
        setPreview(null);
        setMessage(responseErrorMessage(response, payload, "Không thể tính trước mức phạt"));
        return;
      }
      setPreview(payload.data as ViolationPreviewDto);
    } catch {
      setPreview(null);
      setMessage("Không thể kết nối máy chủ để tính trước mức phạt. Hãy thử lại.");
    }
  }

  async function openEditor() {
    if (!attendanceId) {
      setMessage("Hãy lưu attendance trước khi thêm lỗi.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/rules/penalty/active?date=${encodeURIComponent(businessDate)}`,
        { cache: "no-store" },
      );
      const payload = await apiPayload(response);
      if (!response.ok) {
        setMessage(responseErrorMessage(response, payload, "Không thể tải danh sách loại lỗi"));
        return;
      }
      const versions = payload.data as readonly PenaltyRuleVersionDto[];
      const activeItems = versions.flatMap((version) =>
        version.items.filter((item) => item.isActive && isManualPenaltyItem(item)),
      );
      setItems(activeItems);
      const first = activeItems[0];
      setSelectedItemId(first?.id ?? "");
      setDetail(first?.description ?? "");
      setEditing(true);
      if (first) void loadPreview(first.id);
      setMessage(activeItems.length === 0 ? "Không có loại lỗi hiệu lực ngày này." : null);
    } catch {
      setMessage("Không thể kết nối máy chủ để tải danh sách loại lỗi. Hãy thử lại.");
    } finally {
      setPending(false);
    }
  }

  function selectItem(id: string) {
    setSelectedItemId(id);
    const item = items.find((candidate) => candidate.id === id);
    setDetail(item?.description ?? "");
    setAmountOverride("");
    setOverrideReason("");
    void loadPreview(id);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attendanceId || !selectedItemId) return;
    setPending(true);
    try {
      const response = await fetch("/api/violations", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendanceId,
          penaltyItemId: selectedItemId,
          detail,
          note: note || null,
          amountOverride: amountOverride || null,
          overrideReason: overrideReason || null,
        }),
      });
      const payload = await apiPayload(response);
      if (!response.ok) {
        setMessage(responseErrorMessage(response, payload, "Không thể thêm lỗi"));
        return;
      }
      resetViolationForm();
      setMessage("Đã thêm lỗi và snapshot mức phạt.");
      onChanged();
    } catch {
      setMessage("Không thể kết nối máy chủ để thêm lỗi. Hãy thử lại.");
    } finally {
      setPending(false);
    }
  }

  async function cancel(violation: ViolationDto) {
    setPending(true);
    try {
      const response = await fetch(`/api/violations/${violation.id}`, {
        method: "DELETE",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: violation.version }),
      });
      const payload = await apiPayload(response);
      if (!response.ok) {
        setMessage(responseErrorMessage(response, payload, "Không thể hủy lỗi"));
        return;
      }
      setMessage("Đã hủy lỗi; record và snapshot vẫn được giữ.");
      onChanged();
    } catch {
      setMessage("Không thể kết nối máy chủ để hủy lỗi. Hãy thử lại.");
    } finally {
      setPending(false);
    }
  }

  async function uploadEvidence(violation: ViolationDto, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setMessage("Chỉ chấp nhận evidence JPEG, PNG hoặc WebP.");
      return;
    }
    if (file.size < 1 || file.size > EVIDENCE_MAX_SIZE_BYTES) {
      setMessage("Mỗi ảnh evidence phải có dung lượng từ 1 byte đến 10 MB.");
      return;
    }
    setPending(true);
    try {
      const checksumSha256 = await sha256Base64(file);
      const presignResponse = await fetch("/api/evidence/presign", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          violationId: violation.id,
          originalFileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          checksumSha256,
        }),
      });
      const presignPayload = await apiPayload(presignResponse);
      if (!presignResponse.ok) {
        throw new Error(
          responseErrorMessage(
            presignResponse,
            presignPayload,
            "Không thể chuẩn bị upload evidence",
          ),
        );
      }
      if (!validEvidencePresignData(presignPayload.data)) {
        throw new Error("Phản hồi chuẩn bị upload evidence không hợp lệ. Hãy thử lại.");
      }
      const result = presignPayload.data;
      assertSameOriginEvidenceUploadUrl(result.upload.url);

      const uploadResponse = await putEvidence(result.upload.url, result.upload.headers, file);
      const uploadPayload = await apiPayload(uploadResponse);
      if (!uploadResponse.ok) {
        throw new Error(
          responseErrorMessage(uploadResponse, uploadPayload, "Không thể upload evidence"),
        );
      }
      if (!isReadyEvidence(uploadPayload.data)) {
        throw new Error("Phản hồi upload evidence không hợp lệ. Hãy thử lại.");
      }
      setMessage("Đã upload và xác minh checksum evidence.");
      onChanged();
    } catch (error) {
      setMessage(
        isAbortError(error)
          ? `Máy chủ không phản hồi sau ${EVIDENCE_UPLOAD_TIMEOUT_MS / 1_000} giây. Hãy thử lại.`
          : error instanceof Error
            ? error.message
            : "Không thể upload evidence.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        aria-label={`Mở lỗi và evidence ngày ${businessDate}, ${activeViolationCount} lỗi hiện hành`}
        className={`inline-flex min-h-10 w-full min-w-0 items-start gap-2 rounded-lg border p-2 text-left transition ${
          activeViolationCount > 0
            ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
            : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabledReason !== null}
        onClick={openPanel}
        title={
          disabledReason ??
          (activeViolationCount > 0
            ? activeViolations.map((violation) => violation.itemName).join(", ")
            : `Thêm lỗi ngày ${businessDate}`)
        }
        type="button"
      >
        <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 9v4m0 4h.01M10.3 4.5 2.6 18a2 2 0 0 0 1.74 3h15.32a2 2 0 0 0 1.74-3L13.7 4.5a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
        {activeViolationCount > 0 ? (
          <span className="grid min-w-0 flex-1 gap-1">
            {activeViolations.map((violation) => (
              <span
                className="block max-w-full whitespace-normal break-words rounded-md px-2 py-1 text-xs font-medium leading-4 text-white [overflow-wrap:anywhere]"
                key={violation.id}
                style={{ backgroundColor: violation.displayColor }}
                title={violation.itemName}
              >
                {violation.itemName}
              </span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 text-xs leading-5">Thêm lỗi</span>
        )}
      </button>

      {panelOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/40 p-2 sm:p-4"
          role="presentation"
        >
          <div
            aria-label={`Lỗi và evidence ngày ${businessDate}`}
            aria-modal="true"
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
            role="dialog"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">
                  Lỗi & evidence
                </h3>
                <p className="break-words text-sm text-slate-500 [overflow-wrap:anywhere]">
                  Ngày {businessDate}
                </p>
              </div>
              <button
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={closePanel}
                type="button"
              >
                Đóng
              </button>
            </div>

            <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Phạt: {money(activePenaltyTotal)}</span>
                <button
                  className="text-sky-700 underline"
                  disabled={pending || !attendanceId}
                  onClick={() => void openEditor()}
                  type="button"
                >
                  Thêm lỗi
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {violations.length === 0 ? (
                  <p className="text-xs text-slate-400">Chưa có lỗi.</p>
                ) : (
                  violations.map((violation) => (
                    <div
                      className={`rounded-lg border p-2 text-xs ${
                        violation.status === "CANCELLED" ? "opacity-50" : ""
                      }`}
                      key={violation.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="max-w-full whitespace-normal break-words rounded-full px-2 py-1 font-medium text-white [overflow-wrap:anywhere]"
                          style={{ backgroundColor: violation.displayColor }}
                        >
                          {violation.itemName}
                        </span>
                        <span>{money(violation.amount)}</span>
                        <span className="font-medium text-slate-600">
                          {violation.isChargeable
                            ? `Lần ${violation.occurrenceNo}`
                            : `Nhắc lần ${violation.occurrenceNo}/${violation.penaltyStartsAt - 1}`}
                        </span>
                        {violation.status === "CANCELLED" ? <span>Đã hủy</span> : null}
                        {violation.origin === "AUTOMATIC" ? (
                          <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-800">
                            {violation.automaticSnapshot?.triggerType === "CHECK_IN_LATE"
                              ? "Tự động từ check-in"
                              : "Tự động từ thời lượng Live"}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {violation.detail}
                      </p>
                      {violation.note ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-slate-500 [overflow-wrap:anywhere]">
                          {violation.note}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {violation.evidence
                          .filter((evidence) => evidence.status === "READY")
                          .map((evidence) => (
                            <EvidenceThumbnail
                              evidenceId={evidence.id}
                              key={evidence.id}
                              name={evidence.originalFileName}
                            />
                          ))}
                      </div>
                      {violation.status === "ACTIVE" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <label className="cursor-pointer text-sky-700 underline">
                            Thêm ảnh
                            <input
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              disabled={pending}
                              onChange={(event) => void uploadEvidence(violation, event)}
                              type="file"
                            />
                          </label>
                          <button
                            className="text-rose-700 underline"
                            disabled={pending}
                            onClick={() => void cancel(violation)}
                            type="button"
                          >
                            Hủy lỗi
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {editing ? (
                <form
                  className="mt-3 grid gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3"
                  onSubmit={(event) => void create(event)}
                >
                  <label className="grid gap-1 text-xs">
                    Loại lỗi hiệu lực ngày {businessDate}
                    <select
                      aria-label={`Loại lỗi ${businessDate}`}
                      className="w-full min-w-0 text-ellipsis"
                      onChange={(event) => selectItem(event.target.value)}
                      required
                      style={{
                        borderLeftColor: selectedItem?.displayColor,
                        borderLeftWidth: "0.45rem",
                      }}
                      value={selectedItemId}
                    >
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} — {item.name} — {money(item.defaultAmount)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedItem ? (
                    <span
                      className="max-w-full whitespace-normal break-words rounded-full px-2 py-1 text-xs font-medium text-white [overflow-wrap:anywhere]"
                      style={{ backgroundColor: selectedItem.displayColor }}
                    >
                      {selectedItem.name} · {money(selectedItem.defaultAmount)}
                    </span>
                  ) : null}
                  {preview ? (
                    <div
                      className={`break-words rounded-lg border px-3 py-2 text-xs font-medium [overflow-wrap:anywhere] ${
                        preview.isChargeable
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {preview.message}
                    </div>
                  ) : null}
                  <label className="grid gap-1 text-xs">
                    Chi tiết thực tế
                    <textarea
                      aria-label={`Chi tiết lỗi ${businessDate}`}
                      onChange={(event) => setDetail(event.target.value)}
                      required
                      rows={2}
                      value={detail}
                    />
                  </label>
                  <input
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Ghi chú thêm"
                    value={note}
                  />
                  {canOverrideAmount ? (
                    <>
                      <input
                        min="0"
                        onChange={(event) => setAmountOverride(event.target.value)}
                        placeholder="Override tiền phạt (không bắt buộc)"
                        type="number"
                        value={amountOverride}
                      />
                      {amountOverride ? (
                        <input
                          onChange={(event) => setOverrideReason(event.target.value)}
                          placeholder="Lý do override"
                          required
                          value={overrideReason}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex gap-3">
                    <button
                      className="font-medium text-sky-700 underline"
                      disabled={pending || items.length === 0}
                      type="submit"
                    >
                      Ghi lỗi
                    </button>
                    <button
                      className="text-slate-500 underline"
                      onClick={() => setEditing(false)}
                      type="button"
                    >
                      Đóng
                    </button>
                  </div>
                </form>
              ) : null}
              {message ? (
                <p
                  aria-live="polite"
                  className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600 [overflow-wrap:anywhere]"
                >
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
