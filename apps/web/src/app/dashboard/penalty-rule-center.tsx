"use client";

import type {
  PenaltyItemDto,
  PenaltyRuleComparisonDto,
  PenaltyRuleSetDto,
  PenaltyRuleVersionDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type EditablePenaltyItem = Omit<PenaltyItemDto, "id" | "reminderPolicy" | "metadata">;

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

const statusLabels = {
  DRAFT: "Bản nháp",
  SCHEDULED: "Đã lên lịch",
  ACTIVE: "Đang hiệu lực",
  RETIRED: "Đã kết thúc",
} as const;

function payloadError(payload: ApiPayload): string {
  return typeof payload.error?.message === "string"
    ? payload.error.message
    : "Không thể xử lý rule.";
}

function emptyItem(order: number): EditablePenaltyItem {
  return {
    code: "",
    name: "",
    description: "",
    defaultAmount: "0",
    isActive: true,
    displayColor: "#EF4444",
    displayOrder: order,
  };
}

export function PenaltyRuleCenter() {
  const [ruleSets, setRuleSets] = useState<readonly PenaltyRuleSetDto[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<readonly EditablePenaltyItem[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [comparison, setComparison] = useState<PenaltyRuleComparisonDto | null>(null);
  const selectedDraftIdRef = useRef("");

  const selectDraft = useCallback((version: PenaltyRuleVersionDto | undefined) => {
    if (!version) {
      selectedDraftIdRef.current = "";
      setSelectedDraftId("");
      setNotes("");
      setItems([]);
      return;
    }
    selectedDraftIdRef.current = version.id;
    setSelectedDraftId(version.id);
    setNotes(version.notes ?? "");
    setItems(
      version.items.map((item) => ({
        code: item.code,
        name: item.name,
        description: item.description,
        defaultAmount: item.defaultAmount,
        isActive: item.isActive,
        displayColor: item.displayColor,
        displayOrder: item.displayOrder,
      })),
    );
  }, []);

  const loadRules = useCallback(
    async (preferredDraftId?: string) => {
      setLoading(true);
      const response = await fetch("/api/rules/penalty", { cache: "no-store" });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        setMessage(payloadError(payload));
        setLoading(false);
        return;
      }
      const next = payload.data as readonly PenaltyRuleSetDto[];
      setRuleSets(next);
      const drafts = next.flatMap((ruleSet) =>
        ruleSet.versions.filter((version) => version.status === "DRAFT"),
      );
      const selected =
        drafts.find((version) => version.id === preferredDraftId) ??
        drafts.find((version) => version.id === selectedDraftIdRef.current) ??
        drafts[0];
      selectDraft(selected);
      setLoading(false);
    },
    [selectDraft],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadRules(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadRules]);

  async function postJson(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) throw new Error(payloadError(payload));
    return payload.data;
  }

  async function createRuleSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = (await postJson("/api/rules/penalty", {
        name: String(form.get("name") ?? ""),
        reason,
      })) as PenaltyRuleSetDto;
      setMessage("Đã tạo bộ rule và draft version 1.");
      event.currentTarget.reset();
      await loadRules(created.versions[0]?.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể tạo rule.");
    }
  }

  async function cloneVersion(ruleSetId: string, versionId: string) {
    try {
      const created = (await postJson("/api/rules/penalty/drafts", {
        ruleSetId,
        cloneFromVersionId: versionId,
        notes: null,
        reason,
      })) as PenaltyRuleVersionDto;
      setMessage(`Đã clone thành draft version ${created.versionNo}.`);
      await loadRules(created.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể clone version.");
    }
  }

  async function saveDraft() {
    const draft = ruleSets
      .flatMap((ruleSet) => ruleSet.versions)
      .find((version) => version.id === selectedDraftId);
    if (!draft) return;
    try {
      const response = await fetch(`/api/rules/penalty/versions/${draft.id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes || null,
          items,
          rowVersion: draft.rowVersion,
          reason,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(payloadError(payload));
      setMessage("Đã lưu draft và audit.");
      await loadRules(draft.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu draft.");
    }
  }

  async function publishDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = ruleSets
      .flatMap((ruleSet) => ruleSet.versions)
      .find((version) => version.id === selectedDraftId);
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    try {
      await postJson(`/api/rules/penalty/versions/${draft.id}/publish`, {
        effectiveFrom: String(form.get("effectiveFrom") ?? ""),
        effectiveTo: String(form.get("effectiveTo") ?? "") || null,
        rowVersion: draft.rowVersion,
        reason,
      });
      setMessage(`Đã publish version ${draft.versionNo}.`);
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể publish.");
    }
  }

  async function retireVersion(event: FormEvent<HTMLFormElement>, version: PenaltyRuleVersionDto) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await postJson(`/api/rules/penalty/versions/${version.id}/retire`, {
        effectiveTo: String(form.get("effectiveTo") ?? ""),
        rowVersion: version.rowVersion,
        reason,
      });
      setMessage(`Đã retire version ${version.versionNo}.`);
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể retire.");
    }
  }

  async function compareVersions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fromVersionId = String(form.get("fromVersionId") ?? "");
    const toVersionId = String(form.get("toVersionId") ?? "");
    const response = await fetch(
      `/api/rules/penalty/compare?fromVersionId=${encodeURIComponent(fromVersionId)}&toVersionId=${encodeURIComponent(toVersionId)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setMessage(payloadError(payload));
      return;
    }
    setComparison(payload.data as PenaltyRuleComparisonDto);
  }

  function updateItem<K extends keyof EditablePenaltyItem>(
    index: number,
    field: K,
    value: EditablePenaltyItem[K],
  ) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
  }

  const allVersions = ruleSets.flatMap((ruleSet) => ruleSet.versions);
  const selectedDraft = allVersions.find((version) => version.id === selectedDraftId);

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Rule Center — Phạt</h2>
          <p className="mt-1 text-sm text-slate-500">
            Published version bất biến · khoảng hiệu lực [từ, đến)
          </p>
        </div>
        <label className="grid min-w-72 gap-1 text-sm">
          Lý do thao tác
          <input
            aria-label="Lý do thay đổi rule"
            onChange={(event) => setReason(event.target.value)}
            placeholder="Bắt buộc để ghi audit"
            value={reason}
          />
        </label>
      </div>
      {message ? (
        <p aria-live="polite" className="mt-3 text-sm text-slate-700">
          {message}
        </p>
      ) : null}

      <form className="mt-5 flex flex-wrap gap-3" onSubmit={createRuleSet}>
        <input name="name" placeholder="Tên bộ rule phạt" required />
        <Button disabled={!reason.trim()} type="submit">
          Tạo RuleSet
        </Button>
      </form>

      {loading ? (
        <p className="mt-6 rounded-xl bg-slate-50 p-5">Đang tải lịch sử rule…</p>
      ) : ruleSets.length === 0 ? (
        <p className="mt-6 rounded-xl bg-slate-50 p-5 text-slate-500">Chưa có bộ rule phạt.</p>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            {ruleSets.map((ruleSet) => (
              <div className="rounded-xl border border-slate-200 p-4" key={ruleSet.id}>
                <h3 className="font-semibold">{ruleSet.name}</h3>
                <div className="mt-3 space-y-2">
                  {ruleSet.versions.map((version) => (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm" key={version.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          v{version.versionNo} · {statusLabels[version.effectiveStatus]}
                        </span>
                        <span className="text-xs text-slate-500">
                          {version.effectiveFrom ?? "—"} → {version.effectiveTo ?? "∞"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {version.status === "DRAFT" ? (
                          <button
                            className="text-sky-700 underline"
                            onClick={() => selectDraft(version)}
                            type="button"
                          >
                            Mở draft
                          </button>
                        ) : (
                          <button
                            className="text-sky-700 underline"
                            disabled={!reason.trim()}
                            onClick={() => void cloneVersion(ruleSet.id, version.id)}
                            type="button"
                          >
                            Clone thành draft
                          </button>
                        )}
                      </div>
                      {version.status === "ACTIVE" || version.status === "SCHEDULED" ? (
                        <form
                          className="mt-2 flex gap-2"
                          onSubmit={(event) => void retireVersion(event, version)}
                        >
                          <input
                            aria-label={`Ngày retire version ${version.versionNo}`}
                            name="effectiveTo"
                            required
                            type="date"
                          />
                          <button
                            className="text-rose-700 underline"
                            disabled={!reason.trim()}
                            type="submit"
                          >
                            Retire
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {allVersions.length >= 2 ? (
              <form
                className="rounded-xl border border-slate-200 p-4"
                onSubmit={(event) => void compareVersions(event)}
              >
                <h3 className="font-semibold">So sánh version</h3>
                <div className="mt-3 grid gap-2">
                  <select name="fromVersionId" required>
                    {allVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        Từ v{version.versionNo}
                      </option>
                    ))}
                  </select>
                  <select name="toVersionId" required>
                    {allVersions
                      .slice()
                      .reverse()
                      .map((version) => (
                        <option key={version.id} value={version.id}>
                          Đến v{version.versionNo}
                        </option>
                      ))}
                  </select>
                  <Button type="submit">So sánh</Button>
                </div>
                {comparison ? (
                  <div className="mt-3 text-sm">
                    <p>Thêm: {comparison.addedCodes.join(", ") || "—"}</p>
                    <p>Bỏ: {comparison.removedCodes.join(", ") || "—"}</p>
                    <p>Đổi: {comparison.changedCodes.join(", ") || "—"}</p>
                  </div>
                ) : null}
              </form>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold">
              {selectedDraft
                ? `Draft version ${selectedDraft.versionNo}`
                : "Chọn hoặc clone một draft"}
            </h3>
            {selectedDraft ? (
              <>
                <label className="mt-3 grid gap-1 text-sm">
                  Ghi chú version
                  <textarea
                    onChange={(event) => setNotes(event.target.value)}
                    rows={2}
                    value={notes}
                  />
                </label>
                <div className="mt-4 space-y-3">
                  {items.map((item, index) => (
                    <div
                      className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-2"
                      key={`${index}-${item.code}`}
                    >
                      <input
                        aria-label={`Mã lỗi ${index + 1}`}
                        onChange={(event) => updateItem(index, "code", event.target.value)}
                        placeholder="Mã lỗi"
                        value={item.code}
                      />
                      <input
                        aria-label={`Tên lỗi ${index + 1}`}
                        onChange={(event) => updateItem(index, "name", event.target.value)}
                        placeholder="Tên lỗi"
                        value={item.name}
                      />
                      <textarea
                        aria-label={`Mô tả lỗi ${index + 1}`}
                        className="md:col-span-2"
                        onChange={(event) => updateItem(index, "description", event.target.value)}
                        placeholder="Mô tả mặc định"
                        value={item.description}
                      />
                      <input
                        aria-label={`Mức phạt ${index + 1}`}
                        min="0"
                        onChange={(event) => updateItem(index, "defaultAmount", event.target.value)}
                        placeholder="Mức phạt VND"
                        type="number"
                        value={item.defaultAmount}
                      />
                      <input
                        aria-label={`Màu lỗi ${index + 1}`}
                        onChange={(event) => updateItem(index, "displayColor", event.target.value)}
                        type="color"
                        value={item.displayColor}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          checked={item.isActive}
                          onChange={(event) => updateItem(index, "isActive", event.target.checked)}
                          type="checkbox"
                        />
                        Đang dùng
                      </label>
                      <button
                        className="text-left text-sm text-rose-700 underline"
                        onClick={() =>
                          setItems((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                        type="button"
                      >
                        Xóa khỏi draft
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    onClick={() => setItems((current) => [...current, emptyItem(current.length)])}
                    type="button"
                    variant="secondary"
                  >
                    Thêm loại lỗi
                  </Button>
                  <Button disabled={!reason.trim()} onClick={() => void saveDraft()} type="button">
                    Lưu draft
                  </Button>
                </div>
                <form
                  className="mt-5 grid gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 md:grid-cols-2"
                  onSubmit={(event) => void publishDraft(event)}
                >
                  <label className="grid gap-1 text-sm">
                    Hiệu lực từ
                    <input name="effectiveFrom" required type="date" />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Hiệu lực đến (exclusive)
                    <input name="effectiveTo" type="date" />
                  </label>
                  <Button
                    className="md:col-span-2"
                    disabled={!reason.trim() || items.length === 0}
                    type="submit"
                  >
                    Publish version
                  </Button>
                </form>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Published version không sửa trực tiếp; hãy clone để tạo draft mới.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
