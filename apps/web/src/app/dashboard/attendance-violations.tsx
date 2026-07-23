"use client";

import type { PenaltyItemDto, PenaltyRuleVersionDto, ViolationDto } from "@ald/contracts";
import { useState, type ChangeEvent, type FormEvent } from "react";

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

function errorMessage(payload: ApiPayload): string {
  return typeof payload.error?.message === "string"
    ? payload.error.message
    : "Không thể xử lý vi phạm.";
}

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}

async function sha256Base64(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function EvidenceThumbnail({ evidenceId, name }: Readonly<{ evidenceId: string; name: string }>) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch(`/api/evidence/${evidenceId}/view`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setError(true);
      return;
    }
    setUrl((payload.data as { url: string }).url);
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
  reason,
  canOverrideAmount,
  onChanged,
}: Readonly<{
  attendanceId: string | null;
  businessDate: string;
  violations: readonly ViolationDto[];
  activePenaltyTotal: string;
  reason: string;
  canOverrideAmount: boolean;
  onChanged: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<readonly PenaltyItemDto[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedItem = items.find((item) => item.id === selectedItemId);

  async function openEditor() {
    if (!attendanceId) {
      setMessage("Hãy lưu attendance trước khi thêm lỗi.");
      return;
    }
    setPending(true);
    const response = await fetch(
      `/api/rules/penalty/active?date=${encodeURIComponent(businessDate)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as ApiPayload;
    setPending(false);
    if (!response.ok) {
      setMessage(errorMessage(payload));
      return;
    }
    const versions = payload.data as readonly PenaltyRuleVersionDto[];
    const activeItems = versions.flatMap((version) =>
      version.items.filter((item) => item.isActive),
    );
    setItems(activeItems);
    const first = activeItems[0];
    setSelectedItemId(first?.id ?? "");
    setDetail(first?.description ?? "");
    setEditing(true);
    setMessage(activeItems.length === 0 ? "Không có loại lỗi hiệu lực ngày này." : null);
  }

  function selectItem(id: string) {
    setSelectedItemId(id);
    const item = items.find((candidate) => candidate.id === id);
    setDetail(item?.description ?? "");
    setAmountOverride("");
    setOverrideReason("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attendanceId || !selectedItemId) return;
    if (!reason.trim()) {
      setMessage("Nhập lý do thay đổi attendance trước khi thêm lỗi.");
      return;
    }
    setPending(true);
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
        reason,
      }),
    });
    const payload = (await response.json()) as ApiPayload;
    setPending(false);
    if (!response.ok) {
      setMessage(errorMessage(payload));
      return;
    }
    setEditing(false);
    setMessage("Đã thêm lỗi và snapshot mức phạt.");
    setNote("");
    onChanged();
  }

  async function cancel(violation: ViolationDto) {
    if (!reason.trim()) {
      setMessage("Nhập lý do trước khi hủy lỗi.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/violations/${violation.id}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: violation.version, reason }),
    });
    const payload = (await response.json()) as ApiPayload;
    setPending(false);
    if (!response.ok) {
      setMessage(errorMessage(payload));
      return;
    }
    setMessage("Đã hủy lỗi; record và snapshot vẫn được giữ.");
    onChanged();
  }

  async function uploadEvidence(violation: ViolationDto, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!reason.trim()) {
      setMessage("Nhập lý do trước khi upload evidence.");
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
          reason,
        }),
      });
      const presignPayload = (await presignResponse.json()) as ApiPayload;
      if (!presignResponse.ok) throw new Error(errorMessage(presignPayload));
      const result = presignPayload.data as {
        evidence: { id: string; version: number };
        upload: {
          url: string;
          headers: Readonly<Record<string, string>>;
        };
      };

      const uploadResponse = await fetch(result.upload.url, {
        method: "PUT",
        headers: result.upload.headers,
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Object storage từ chối upload (${uploadResponse.status}).`);
      }

      const completeResponse = await fetch(`/api/evidence/${result.evidence.id}/complete`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: result.evidence.version }),
      });
      const completePayload = (await completeResponse.json()) as ApiPayload;
      if (!completeResponse.ok) throw new Error(errorMessage(completePayload));
      setMessage("Đã upload và xác minh checksum evidence.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể upload evidence.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-80">
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
                  className="rounded-full px-2 py-1 font-medium text-white"
                  style={{ backgroundColor: violation.displayColor }}
                >
                  {violation.itemName}
                </span>
                <span>{money(violation.amount)}</span>
                {violation.status === "CANCELLED" ? <span>Đã hủy</span> : null}
              </div>
              <p className="mt-1">{violation.detail}</p>
              {violation.note ? <p className="mt-1 text-slate-500">{violation.note}</p> : null}
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
              className="w-fit rounded-full px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: selectedItem.displayColor }}
            >
              {selectedItem.name} · {money(selectedItem.defaultAmount)}
            </span>
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
        <p aria-live="polite" className="mt-2 text-xs text-slate-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}
