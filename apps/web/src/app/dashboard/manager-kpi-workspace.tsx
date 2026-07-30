"use client";

import type {
  ManagerKpiCandidateDto,
  ManagerKpiEvaluationDto,
  ManagerKpiSettingDto,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useState } from "react";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "Không thể xử lý KPI.");
  }
  return payload.data;
}

function KpiEditor({
  evaluation,
  onSaved,
}: Readonly<{
  evaluation: ManagerKpiEvaluationDto;
  onSaved: (value: ManagerKpiEvaluationDto) => void;
}>) {
  const [criteria, setCriteria] = useState(() =>
    evaluation.criteria.map((line) => ({
      code: line.code,
      score: line.score,
      note: line.note ?? "",
      evidence: line.evidence ?? "",
    })),
  );
  const [notes, setNotes] = useState(evaluation.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const saved = await fetch(`/api/manager-kpi/evaluations/${evaluation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: evaluation.version,
          notes: notes || null,
          criteria: criteria.map((line) => ({
            ...line,
            note: line.note || null,
            evidence: line.evidence || null,
          })),
        }),
      }).then(responseData<ManagerKpiEvaluationDto>);
      onSaved(saved);
      setMessage("Đã lưu draft KPI.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu KPI.");
    } finally {
      setPending(false);
    }
  }

  async function publish(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const published = await fetch(`/api/manager-kpi/evaluations/${evaluation.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: evaluation.version }),
      }).then(responseData<ManagerKpiEvaluationDto>);
      onSaved(published);
      setMessage("Đã publish KPI cho quản lý.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể publish KPI.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {evaluation.manager.staffCode} — {evaluation.manager.fullName}
          </h3>
          <p className="text-sm text-slate-500">
            {evaluation.branch.code} · {evaluation.template.ruleSetName} v
            {evaluation.template.versionNo} · Chấm công {evaluation.attendance.workUnits} công
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-slate-500">Tổng điểm</div>
          <div className="text-xl font-semibold">
            {evaluation.totalScore}/{evaluation.maximumScore}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {evaluation.criteria.map((line, index) => (
          <div className="grid gap-3 rounded-lg bg-slate-50 p-4 lg:grid-cols-4" key={line.id}>
            <div>
              <div className="font-medium">
                {line.code} — {line.name}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Trọng số {line.weightBps / 100}% · tối đa {line.maxScore}
              </div>
              <p className="mt-2 text-sm text-slate-600">{line.description}</p>
            </div>
            <label className="grid content-start gap-1 text-sm">
              Điểm
              <input
                disabled={evaluation.status === "PUBLISHED"}
                inputMode="decimal"
                max={line.maxScore}
                min="0"
                onChange={(event) =>
                  setCriteria((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, score: event.target.value } : item,
                    ),
                  )
                }
                value={criteria[index]?.score ?? "0"}
              />
            </label>
            <label className="grid content-start gap-1 text-sm">
              Ghi chú {line.requiredNote ? "*" : ""}
              <textarea
                disabled={evaluation.status === "PUBLISHED"}
                onChange={(event) =>
                  setCriteria((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, note: event.target.value } : item,
                    ),
                  )
                }
                rows={3}
                value={criteria[index]?.note ?? ""}
              />
            </label>
            <label className="grid content-start gap-1 text-sm">
              Minh chứng {line.requiredEvidence ? "*" : ""}
              <textarea
                disabled={evaluation.status === "PUBLISHED"}
                onChange={(event) =>
                  setCriteria((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, evidence: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Mã tài liệu, link private hoặc mô tả minh chứng"
                rows={3}
                value={criteria[index]?.evidence ?? ""}
              />
            </label>
          </div>
        ))}
      </div>
      {evaluation.status === "DRAFT" ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
          <textarea
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Nhận xét tổng hợp"
            value={notes}
          />
          <Button disabled={pending} onClick={() => void save()}>
            Lưu draft
          </Button>
          <Button disabled={pending} onClick={() => void publish()}>
            Publish
          </Button>
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          KPI đã publish lúc{" "}
          {evaluation.publishedAt
            ? new Intl.DateTimeFormat("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(evaluation.publishedAt))
            : "—"}
          .
        </p>
      )}
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}

export function ManagerKpiWorkspace({ isGeneralManager }: Readonly<{ isGeneralManager: boolean }>) {
  const [month, setMonth] = useState(currentMonth);
  const [evaluations, setEvaluations] = useState<readonly ManagerKpiEvaluationDto[]>([]);
  const [candidates, setCandidates] = useState<readonly ManagerKpiCandidateDto[]>([]);
  const [setting, setSetting] = useState<ManagerKpiSettingDto | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [evaluationData, settingData, candidateData] = await Promise.all([
        fetch(`/api/manager-kpi/evaluations?month=${month}`, { cache: "no-store" }).then(
          responseData<readonly ManagerKpiEvaluationDto[]>,
        ),
        fetch("/api/manager-kpi/settings", { cache: "no-store" }).then(
          responseData<ManagerKpiSettingDto>,
        ),
        isGeneralManager
          ? fetch(`/api/manager-kpi/candidates?month=${month}`, { cache: "no-store" }).then(
              responseData<readonly ManagerKpiCandidateDto[]>,
            )
          : Promise.resolve([]),
      ]);
      setEvaluations(evaluationData);
      setSetting(settingData);
      setCandidates(candidateData);
      setSelectedId((current) =>
        evaluationData.some((item) => item.id === current)
          ? current
          : (evaluationData[0]?.id ?? ""),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể tải KPI.");
      setEvaluations([]);
    } finally {
      setLoading(false);
    }
  }, [isGeneralManager, month]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function replaceEvaluation(value: ManagerKpiEvaluationDto): void {
    setEvaluations((current) => current.map((item) => (item.id === value.id ? value : item)));
  }

  async function createEvaluation(): Promise<void> {
    setMessage(null);
    try {
      const created = await fetch("/api/manager-kpi/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerStaffId: candidateId,
          month,
          notes: null,
        }),
      }).then(responseData<ManagerKpiEvaluationDto>);
      setEvaluations((current) => [created, ...current]);
      setSelectedId(created.id);
      setMessage("Đã tạo draft KPI từ template hiệu lực.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể tạo KPI.");
    }
  }

  async function toggleSetting(): Promise<void> {
    if (!setting) return;
    try {
      const updated = await fetch("/api/manager-kpi/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !setting.enabled,
          version: setting.version,
        }),
      }).then(responseData<ManagerKpiSettingDto>);
      setSetting(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể cập nhật cài đặt.");
    }
  }

  const selected = evaluations.find((item) => item.id === selectedId) ?? null;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-violet-700">
            Manager KPI
          </p>
          <h2 className="mt-1 text-xl font-semibold">KPI quản lý đào tạo</h2>
          <p className="mt-1 text-sm text-slate-500">
            Template versioned, điểm trọng số, chấm công tháng và publish bất biến.
          </p>
        </div>
        {isGeneralManager && setting ? (
          <Button onClick={() => void toggleSetting()}>
            Self-service: {setting.enabled ? "Đang bật" : "Đang tắt"}
          </Button>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Tháng KPI
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        {isGeneralManager ? (
          <>
            <label className="grid min-w-72 gap-1 text-sm">
              Quản lý
              <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
                <option value="">Chọn quản lý đào tạo</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.staffCode} — {candidate.fullName} · {candidate.branch.code}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={!candidateId} onClick={() => void createEvaluation()}>
              Tạo đánh giá
            </Button>
          </>
        ) : null}
      </div>

      {message ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</p>
      ) : null}
      {loading ? (
        <p className="mt-5 text-sm text-slate-500">Đang tải KPI…</p>
      ) : evaluations.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">
          {isGeneralManager
            ? "Chưa có đánh giá KPI trong tháng."
            : "Chưa có KPI đã publish hoặc self-service chưa được bật."}
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {evaluations.map((evaluation) => (
              <Button
                key={evaluation.id}
                onClick={() => setSelectedId(evaluation.id)}
                variant={evaluation.id === selectedId ? "primary" : "soft"}
              >
                {evaluation.manager.staffCode} · {evaluation.status}
              </Button>
            ))}
          </div>
          {selected ? (
            isGeneralManager ? (
              <KpiEditor evaluation={selected} key={selected.id} onSaved={replaceEvaluation} />
            ) : (
              <div className="mt-5 rounded-xl border border-slate-200 p-4">
                <h3 className="font-medium">
                  {selected.manager.fullName} · {selected.totalScore}/{selected.maximumScore}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selected.branch.code} · {selected.template.ruleSetName} v
                  {selected.template.versionNo}
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Tiêu chí</th>
                        <th className="px-3 py-2 text-right">Điểm</th>
                        <th className="px-3 py-2 text-left">Ghi chú</th>
                        <th className="px-3 py-2 text-left">Minh chứng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.criteria.map((line) => (
                        <tr className="border-t border-slate-100" key={line.id}>
                          <td className="px-3 py-2">
                            {line.code} — {line.name}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {line.score}/{line.maxScore}
                          </td>
                          <td className="px-3 py-2">{line.note ?? "—"}</td>
                          <td className="px-3 py-2">{line.evidence ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
