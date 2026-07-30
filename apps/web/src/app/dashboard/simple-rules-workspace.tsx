"use client";

import type { AutomaticPenaltyConditionDto, SimpleRulesDto } from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

type RewardRow = Readonly<{
  key: string;
  thresholdAmount: string;
  rewardAmount: string;
}>;

type MonthlyLevelRow = Readonly<{
  key: string;
  code?: string;
  name: string;
  monthlyCoinThreshold: string;
  attendanceBonus: string;
  achievementBonus: string;
  retainLevelBonus: string;
  jumpLevelBonus: string;
}>;

type PenaltyRow = Readonly<{
  key: string;
  code?: string;
  name: string;
  description: string;
  defaultAmount: string;
  reminderCount: number;
  countingWindow: "CALENDAR_MONTH" | "LIFETIME";
  displayColor: string;
  isActive: boolean;
  automaticCondition: AutomaticPenaltyConditionDto;
}>;

type RuleBranchOption = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}>;

const statusText = {
  EMPTY: "Chưa có quy định",
  ACTIVE: "Đang áp dụng",
  SCHEDULED: "Đã lên lịch",
  RETIRED: "Đã ngừng",
} as const;

function localKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

function displayDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatAmount(value: string): string {
  if (!/^\d+$/.test(value)) return "0";
  return new Intl.NumberFormat("vi-VN").format(BigInt(value));
}

function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 47) return null;
  return hours * 60 + minutes;
}

function basisPointsToPercent(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = String(value % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function percentToBasisPoints(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  const match = /^(100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/.exec(normalized);
  if (!match) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return basisPoints <= 10_000 ? basisPoints : null;
}

function errorMessage(payload: ApiPayload, fallback: string): string {
  return typeof payload.error?.message === "string" ? payload.error.message : fallback;
}

export function SimpleRulesWorkspace({
  canEdit,
  branches,
}: Readonly<{ canEdit: boolean; branches: readonly RuleBranchOption[] }>) {
  const [activeTab, setActiveTab] = useState<"reward" | "monthly" | "penalty" | "salary">(
    "monthly",
  );
  const [rules, setRules] = useState<SimpleRulesDto | null>(null);
  const [rewardRows, setRewardRows] = useState<readonly RewardRow[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<readonly MonthlyLevelRow[]>([]);
  const [penaltyRows, setPenaltyRows] = useState<readonly PenaltyRow[]>([]);
  const [rewardDate, setRewardDate] = useState(today);
  const [monthlyDate, setMonthlyDate] = useState(today);
  const [attendanceRequiredDays, setAttendanceRequiredDays] = useState("26");
  const [penaltyDate, setPenaltyDate] = useState(today);
  const [salaryDate, setSalaryDate] = useState(today);
  const [standardDaysOff, setStandardDaysOff] = useState("");
  const [probationSalaryRate, setProbationSalaryRate] = useState("85");
  const [standardDailyMinutes, setStandardDailyMinutes] = useState("");
  const [overtimeMultiplier, setOvertimeMultiplier] = useState("");
  const [roundingUnit, setRoundingUnit] = useState<"" | 1 | 10 | 100 | 1_000>("");
  const [roundingMode, setRoundingMode] = useState<
    "" | "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEILING"
  >("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rules/simple", { cache: "no-store" });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(errorMessage(payload, "Không thể tải quy định."));
      const data = payload.data as SimpleRulesDto;
      setRules(data);
      setRewardRows(
        data.reward.tiers.map((tier, index) => ({
          key: `reward-${tier.thresholdAmount}-${index}`,
          ...tier,
        })),
      );
      setMonthlyRows(
        data.monthlyLevel.levels.map((level) => ({
          key: `monthly-${level.code}`,
          code: level.code,
          name: level.name,
          monthlyCoinThreshold: level.monthlyCoinThreshold,
          attendanceBonus: level.attendanceBonus,
          achievementBonus: level.achievementBonus,
          retainLevelBonus: level.retainLevelBonus,
          jumpLevelBonus: level.jumpLevelBonus,
        })),
      );
      setPenaltyRows(
        data.penalty.items.map((item) => ({
          key: `penalty-${item.code}`,
          ...item,
        })),
      );
      setRewardDate(data.reward.effectiveFrom ?? today());
      setMonthlyDate(data.monthlyLevel.effectiveFrom ?? today());
      setAttendanceRequiredDays(String(data.monthlyLevel.attendanceRequiredDays));
      setPenaltyDate(data.penalty.effectiveFrom ?? today());
      setSalaryDate(data.salary.effectiveFrom ?? today());
      setStandardDaysOff(
        data.salary.standardDaysOffPerMonth === null
          ? ""
          : String(data.salary.standardDaysOffPerMonth),
      );
      setProbationSalaryRate(basisPointsToPercent(data.salary.probationSalaryRateBps));
      setStandardDailyMinutes(
        data.salary.standardDailyMinutes === null ? "" : String(data.salary.standardDailyMinutes),
      );
      setOvertimeMultiplier(
        data.salary.overtimeMultiplierBps === null
          ? ""
          : String(data.salary.overtimeMultiplierBps / 10_000),
      );
      setRoundingUnit(data.salary.roundingUnit ?? "");
      setRoundingMode(data.salary.roundingMode ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải quy định.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadRules(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadRules]);

  const rewardPreview = useMemo(
    () =>
      [...rewardRows]
        .filter((row) => /^\d+$/.test(row.thresholdAmount) && /^\d+$/.test(row.rewardAmount))
        .sort((left, right) => Number(left.thresholdAmount) - Number(right.thresholdAmount)),
    [rewardRows],
  );

  function updateReward(key: string, patch: Partial<RewardRow>) {
    setRewardRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setMessage(null);
  }

  function updatePenalty(key: string, patch: Partial<PenaltyRow>) {
    setPenaltyRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setMessage(null);
  }

  function updateMonthlyLevel(key: string, patch: Partial<MonthlyLevelRow>) {
    setMonthlyRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setMessage(null);
  }

  function moveMonthlyLevel(index: number, direction: -1 | 1) {
    setMonthlyRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setMessage(null);
  }

  async function applyRewardRules() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/rules/simple/rewards", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: rewardDate,
          tiers: rewardRows.map(({ thresholdAmount, rewardAmount }) => ({
            thresholdAmount,
            rewardAmount,
          })),
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(errorMessage(payload, "Không thể áp dụng bảng thưởng."));
      setMessage(`Đã lưu bảng thưởng và áp dụng từ ${displayDate(rewardDate)}.`);
      await loadRules();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể áp dụng bảng thưởng.");
    } finally {
      setSaving(false);
    }
  }

  async function applyPenaltyRules() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/rules/simple/penalties", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: penaltyDate,
          items: penaltyRows.map((row) => ({
            ...(row.code ? { code: row.code } : {}),
            name: row.name,
            description: row.description,
            defaultAmount: row.defaultAmount,
            reminderCount: row.reminderCount,
            countingWindow: row.countingWindow,
            displayColor: row.displayColor,
            isActive: row.isActive,
            automaticCondition: row.automaticCondition,
          })),
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(errorMessage(payload, "Không thể áp dụng bảng phạt."));
      setMessage(`Đã lưu bảng phạt và áp dụng từ ${displayDate(penaltyDate)}.`);
      await loadRules();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể áp dụng bảng phạt.");
    } finally {
      setSaving(false);
    }
  }

  async function applyMonthlyLevelRules() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/rules/simple/monthly-levels", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: monthlyDate,
          attendanceRequiredDays: Number(attendanceRequiredDays),
          levels: monthlyRows.map((row) => ({
            ...(row.code ? { code: row.code } : {}),
            name: row.name,
            monthlyCoinThreshold: row.monthlyCoinThreshold,
            attendanceBonus: row.attendanceBonus,
            achievementBonus: row.achievementBonus,
            retainLevelBonus: row.retainLevelBonus,
            jumpLevelBonus: row.jumpLevelBonus,
          })),
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Không thể áp dụng bảng thưởng tháng."));
      }
      setMessage(`Đã lưu bảng thưởng tháng và áp dụng từ ${displayDate(monthlyDate)}.`);
      await loadRules();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Không thể áp dụng bảng thưởng tháng.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function applySalaryRules() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const multiplier = Number(overtimeMultiplier);
      const probationSalaryRateBps = percentToBasisPoints(probationSalaryRate);
      if (
        standardDaysOff === "" ||
        probationSalaryRateBps === null ||
        standardDailyMinutes === "" ||
        overtimeMultiplier === "" ||
        roundingUnit === "" ||
        roundingMode === "" ||
        !Number.isFinite(multiplier) ||
        multiplier < 0
      ) {
        throw new Error("Hãy nhập đầy đủ và kiểm tra các thông số quy định lương.");
      }
      const response = await fetch("/api/rules/simple/salary", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: salaryDate,
          standardDaysOffPerMonth: Number(standardDaysOff),
          probationSalaryRateBps,
          standardDailyMinutes: Number(standardDailyMinutes),
          overtimeMultiplierBps: Math.round(multiplier * 10_000),
          roundingUnit,
          roundingMode,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(errorMessage(payload, "Không thể áp dụng quy định lương."));
      setMessage(`Đã lưu quy định lương và áp dụng từ ${displayDate(salaryDate)}.`);
      await loadRules();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Không thể áp dụng quy định lương.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Đang tải quy định…
      </section>
    );
  }

  if (!rules) {
    return (
      <section className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        {error ?? "Không thể tải quy định."}
        <button className="ml-2 underline" onClick={() => void loadRules()} type="button">
          Thử lại
        </button>
      </section>
    );
  }

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 pt-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">
              Thiết lập quy định
            </h2>
            <p className="mt-1 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">
              {canEdit
                ? "Chỉnh trực tiếp rồi bấm Lưu & áp dụng. Xu và tiền VND được hiển thị riêng."
                : "Các quy định hiện hành phục vụ vận hành. Tài khoản của bạn chỉ có quyền xem."}
            </p>
          </div>
          {!canEdit ? (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
              Chỉ xem
            </span>
          ) : null}
        </div>
        <div className="mt-5 grid min-w-0 grid-cols-2 gap-1 sm:flex sm:flex-wrap">
          <button
            className={`min-w-0 whitespace-normal break-words rounded-t-xl px-3 py-3 text-sm font-semibold [overflow-wrap:anywhere] sm:px-5 ${
              activeTab === "salary"
                ? "bg-white text-emerald-700 shadow-[0_-1px_0_0_#e2e8f0,1px_0_0_0_#e2e8f0,-1px_0_0_0_#e2e8f0]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            onClick={() => {
              setActiveTab("salary");
              setError(null);
              setMessage(null);
            }}
            type="button"
          >
            Quy định lương
          </button>
          <button
            className={`min-w-0 whitespace-normal break-words rounded-t-xl px-3 py-3 text-sm font-semibold [overflow-wrap:anywhere] sm:px-5 ${
              activeTab === "reward"
                ? "bg-white text-sky-700 shadow-[0_-1px_0_0_#e2e8f0,1px_0_0_0_#e2e8f0,-1px_0_0_0_#e2e8f0]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            onClick={() => {
              setActiveTab("reward");
              setError(null);
              setMessage(null);
            }}
            type="button"
          >
            Thưởng theo xu
          </button>
          <button
            className={`min-w-0 whitespace-normal break-words rounded-t-xl px-3 py-3 text-sm font-semibold [overflow-wrap:anywhere] sm:px-5 ${
              activeTab === "monthly"
                ? "bg-white text-violet-700 shadow-[0_-1px_0_0_#e2e8f0,1px_0_0_0_#e2e8f0,-1px_0_0_0_#e2e8f0]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            onClick={() => {
              setActiveTab("monthly");
              setError(null);
              setMessage(null);
            }}
            type="button"
          >
            Thưởng tháng & cấp bậc
          </button>
          <button
            className={`min-w-0 whitespace-normal break-words rounded-t-xl px-3 py-3 text-sm font-semibold [overflow-wrap:anywhere] sm:px-5 ${
              activeTab === "penalty"
                ? "bg-white text-rose-700 shadow-[0_-1px_0_0_#e2e8f0,1px_0_0_0_#e2e8f0,-1px_0_0_0_#e2e8f0]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            onClick={() => {
              setActiveTab("penalty");
              setError(null);
              setMessage(null);
            }}
            type="button"
          >
            Phạt vi phạm
          </button>
        </div>
      </div>

      {message ? (
        <div className="break-words border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 [overflow-wrap:anywhere]">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="break-words border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-800 [overflow-wrap:anywhere]">
          {error}
        </div>
      ) : null}

      {activeTab === "reward" ? (
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">
                {statusText[rules.reward.status]}
              </span>
              {rules.reward.effectiveFrom
                ? ` · từ ${displayDate(rules.reward.effectiveFrom)}`
                : " · nhập mốc đầu tiên để bắt đầu"}
            </div>
            {canEdit ? (
              <Button
                onClick={() => {
                  const latest = rewardRows.reduce(
                    (maximum, row) =>
                      /^\d+$/.test(row.thresholdAmount)
                        ? Math.max(maximum, Number(row.thresholdAmount))
                        : maximum,
                    5_000,
                  );
                  setRewardRows((current) => [
                    ...current,
                    {
                      key: localKey(),
                      thresholdAmount: String(latest + 5_000),
                      rewardAmount: "0",
                    },
                  ]);
                }}
                type="button"
                variant="outline-sky"
              >
                + Thêm mốc thưởng
              </Button>
            ) : null}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[680px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-16 p-3 text-center">STT</th>
                  <th className="p-3">Đạt từ số xu</th>
                  <th className="p-3">Thưởng</th>
                  <th className="p-3">Kết quả</th>
                  {canEdit ? <th className="w-24 p-3 text-right">Xóa</th> : null}
                </tr>
              </thead>
              <tbody>
                {rewardRows.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-slate-500" colSpan={canEdit ? 5 : 4}>
                      {canEdit
                        ? "Chưa có mốc thưởng. Bấm “Thêm mốc thưởng” để nhập."
                        : "Chưa có mốc thưởng đang áp dụng."}
                    </td>
                  </tr>
                ) : (
                  rewardRows.map((row, index) => (
                    <tr className="border-t border-slate-200" key={row.key}>
                      <td className="p-3 text-center text-slate-500">{index + 1}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <input
                            aria-label={`Mốc xu ${index + 1}`}
                            className="w-40"
                            disabled={!canEdit}
                            inputMode="numeric"
                            min="0"
                            onChange={(event) =>
                              updateReward(row.key, { thresholdAmount: event.target.value })
                            }
                            step="1"
                            type="number"
                            value={row.thresholdAmount}
                          />
                          <span className="text-slate-500">xu</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <input
                            aria-label={`Tiền thưởng ${index + 1}`}
                            className="w-44"
                            disabled={!canEdit}
                            inputMode="numeric"
                            min="0"
                            onChange={(event) =>
                              updateReward(row.key, { rewardAmount: event.target.value })
                            }
                            step="1000"
                            type="number"
                            value={row.rewardAmount}
                          />
                          <span className="text-slate-500">đ</span>
                        </div>
                      </td>
                      <td className="p-3 font-medium text-emerald-700">
                        {formatAmount(row.rewardAmount)}đ/ngày
                      </td>
                      {canEdit ? (
                        <td className="p-3 text-right">
                          <button
                            aria-label={`Xóa mốc ${index + 1}`}
                            className="text-rose-700 underline underline-offset-4"
                            onClick={() =>
                              setRewardRows((current) =>
                                current.filter((candidate) => candidate.key !== row.key),
                              )
                            }
                            type="button"
                          >
                            Xóa
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {rewardPreview.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Cách tính: hệ thống lấy <strong>mốc cao nhất nhân viên đạt được trong ngày</strong>.
              Dưới {formatAmount(rewardPreview[0]!.thresholdAmount)} xu thì thưởng 0đ.
            </p>
          ) : null}

          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-sky-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Áp dụng từ ngày
                <input
                  aria-label="Ngày áp dụng thưởng"
                  onChange={(event) => setRewardDate(event.target.value)}
                  type="date"
                  value={rewardDate}
                />
                <span className="text-xs font-normal text-slate-500">
                  Có thể chọn ngày trong quá khứ. Lưu mới sẽ thay thế ngày áp dụng và quy định hiện
                  tại.
                </span>
              </label>
              <Button
                disabled={saving || rewardRows.length === 0}
                onClick={() => void applyRewardRules()}
                type="button"
              >
                {saving ? "Đang lưu…" : "Lưu & áp dụng bảng thưởng"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : activeTab === "monthly" ? (
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">
                {statusText[rules.monthlyLevel.status]}
              </span>
              {rules.monthlyLevel.effectiveFrom
                ? ` · từ ${displayDate(rules.monthlyLevel.effectiveFrom)}`
                : " · thêm bậc đầu tiên để bắt đầu"}
            </div>
            {canEdit ? (
              <Button
                onClick={() =>
                  setMonthlyRows((current) => [
                    ...current,
                    {
                      key: localKey(),
                      name: "",
                      monthlyCoinThreshold: "0",
                      attendanceBonus: "0",
                      achievementBonus: "0",
                      retainLevelBonus: "0",
                      jumpLevelBonus: "0",
                    },
                  ])
                }
                type="button"
                variant="outline-violet"
              >
                + Thêm bậc
              </Button>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <label className="grid max-w-sm gap-1 text-sm font-semibold text-slate-800">
              Số ngày làm việc để nhận thưởng chuyên cần
              <div className="flex items-center gap-2">
                <input
                  aria-label="Số ngày làm việc để nhận chuyên cần"
                  className="w-28"
                  disabled={!canEdit}
                  max="31"
                  min="1"
                  onChange={(event) => setAttendanceRequiredDays(event.target.value)}
                  step="1"
                  type="number"
                  value={attendanceRequiredDays}
                />
                <span>ngày trở lên</span>
              </div>
              <span className="text-xs font-normal text-slate-600">
                Đếm ngày Có mặt có số công lớn hơn 0; ngày 0,5 công vẫn tính là một ngày.
              </span>
            </label>
          </div>

          <div className="mt-4 max-h-[58vh] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[1540px] text-sm">
              <thead className="sticky top-0 z-20 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-16 p-3 text-center">STT</th>
                  <th className="p-3">Tên bậc</th>
                  <th className="p-3">Mốc xu tháng</th>
                  <th className="p-3">Thưởng chuyên cần</th>
                  <th className="p-3">Thưởng thành tựu</th>
                  <th className="p-3">Thưởng duy trì bậc</th>
                  <th className="p-3">Thưởng nhảy bậc</th>
                  {canEdit ? <th className="w-40 p-3 text-right">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {monthlyRows.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-slate-500" colSpan={canEdit ? 8 : 7}>
                      {canEdit
                        ? "Chưa có bậc. Bấm “Thêm bậc” để nhập bảng thưởng tháng."
                        : "Chưa có bậc thưởng tháng đang áp dụng."}
                    </td>
                  </tr>
                ) : (
                  monthlyRows.map((row, index) => (
                    <tr className="border-t border-slate-200" key={row.key}>
                      <td className="p-3 text-center font-semibold text-slate-500">{index + 1}</td>
                      <td className="p-2">
                        <input
                          aria-label={`Tên bậc ${index + 1}`}
                          className="w-48"
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateMonthlyLevel(row.key, { name: event.target.value })
                          }
                          placeholder="Ví dụ: Khởi Động"
                          value={row.name}
                        />
                      </td>
                      {(
                        [
                          ["monthlyCoinThreshold", "xu"],
                          ["attendanceBonus", "đ"],
                          ["achievementBonus", "đ"],
                          ["retainLevelBonus", "đ"],
                          ["jumpLevelBonus", "đ"],
                        ] as const
                      ).map(([field, unit]) => (
                        <td className="p-2" key={field}>
                          <div className="flex items-center gap-2">
                            <input
                              aria-label={`${field} bậc ${index + 1}`}
                              className="w-36"
                              disabled={!canEdit}
                              inputMode="numeric"
                              min="0"
                              onChange={(event) =>
                                updateMonthlyLevel(row.key, { [field]: event.target.value })
                              }
                              step={unit === "xu" ? "1" : "1000"}
                              type="number"
                              value={row[field]}
                            />
                            <span className="text-slate-500">{unit}</span>
                          </div>
                        </td>
                      ))}
                      {canEdit ? (
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              aria-label={`Đưa bậc ${index + 1} lên`}
                              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-30"
                              disabled={index === 0}
                              onClick={() => moveMonthlyLevel(index, -1)}
                              type="button"
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Đưa bậc ${index + 1} xuống`}
                              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-30"
                              disabled={index === monthlyRows.length - 1}
                              onClick={() => moveMonthlyLevel(index, 1)}
                              type="button"
                            >
                              ↓
                            </button>
                            <button
                              aria-label={`Xóa bậc ${index + 1}`}
                              className="text-rose-700 underline underline-offset-4"
                              onClick={() =>
                                setMonthlyRows((current) =>
                                  current.filter((candidate) => candidate.key !== row.key),
                                )
                              }
                              type="button"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Bậc tháng là mốc xu cao nhất nhân viên đạt. Giữ bậc chỉ nhận thưởng duy trì; tăng bậc
            chỉ nhận thưởng nhảy bậc.
          </div>

          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-violet-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Áp dụng từ ngày
                <input
                  aria-label="Ngày áp dụng thưởng tháng"
                  onChange={(event) => setMonthlyDate(event.target.value)}
                  type="date"
                  value={monthlyDate}
                />
                <span className="text-xs font-normal text-slate-500">
                  Có thể chọn ngày trong quá khứ. Phiếu lương đã gửi vẫn giữ snapshot cũ.
                </span>
              </label>
              <Button
                disabled={
                  saving ||
                  monthlyRows.length === 0 ||
                  attendanceRequiredDays === "" ||
                  Number(attendanceRequiredDays) < 1 ||
                  Number(attendanceRequiredDays) > 31
                }
                onClick={() => void applyMonthlyLevelRules()}
                type="button"
              >
                {saving ? "Đang lưu…" : "Lưu & áp dụng thưởng tháng"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : activeTab === "salary" ? (
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">
                {statusText[rules.salary.status]}
              </span>
              {rules.salary.effectiveFrom
                ? ` · từ ${displayDate(rules.salary.effectiveFrom)}`
                : " · cần lưu trước khi tính Payroll"}
            </div>
          </div>

          <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1 text-sm font-medium">
              Số ngày nghỉ chuẩn/tháng
              <input
                aria-label="Số ngày nghỉ chuẩn mỗi tháng"
                disabled={!canEdit}
                max="30"
                min="0"
                onChange={(event) => setStandardDaysOff(event.target.value)}
                step="1"
                type="number"
                value={standardDaysOff}
              />
              <span className="text-xs font-normal text-slate-500">
                Ngày công chuẩn = số ngày của tháng − số ngày nghỉ.
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tỷ lệ lương thử việc
              <div className="flex items-center gap-2">
                <input
                  aria-label="Tỷ lệ lương thử việc"
                  disabled={!canEdit}
                  max="100"
                  min="0"
                  onChange={(event) => setProbationSalaryRate(event.target.value)}
                  step="0.01"
                  type="number"
                  value={probationSalaryRate}
                />
                <span className="text-slate-500">%</span>
              </div>
              <span className="text-xs font-normal text-slate-500">
                Áp dụng cho công trước ngày lên chính thức.
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Thời gian chuẩn/ngày
              <div className="flex items-center gap-2">
                <input
                  aria-label="Số phút làm việc chuẩn mỗi ngày"
                  className="min-w-0 flex-1"
                  disabled={!canEdit}
                  max="1440"
                  min="1"
                  onChange={(event) => setStandardDailyMinutes(event.target.value)}
                  step="1"
                  type="number"
                  value={standardDailyMinutes}
                />
                <span className="text-slate-500">phút</span>
              </div>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Hệ số tăng ca
              <div className="flex items-center gap-2">
                <input
                  aria-label="Hệ số tăng ca"
                  disabled={!canEdit}
                  min="0"
                  onChange={(event) => setOvertimeMultiplier(event.target.value)}
                  step="0.01"
                  type="number"
                  value={overtimeMultiplier}
                />
                <span className="text-slate-500">lần</span>
              </div>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Làm tròn đến
              <select
                disabled={!canEdit}
                onChange={(event) =>
                  setRoundingUnit(
                    event.target.value === ""
                      ? ""
                      : (Number(event.target.value) as 1 | 10 | 100 | 1_000),
                  )
                }
                value={roundingUnit}
              >
                <option value="">Chọn đơn vị</option>
                <option value="1">1 đồng</option>
                <option value="10">10 đồng</option>
                <option value="100">100 đồng</option>
                <option value="1000">1.000 đồng</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Cách làm tròn
              <select
                disabled={!canEdit}
                onChange={(event) => setRoundingMode(event.target.value as typeof roundingMode)}
                value={roundingMode}
              >
                <option value="">Chọn cách làm tròn</option>
                <option value="HALF_UP">Từ 0,5 làm tròn lên</option>
                <option value="HALF_EVEN">Làm tròn số chẵn gần nhất</option>
                <option value="FLOOR">Luôn làm tròn xuống</option>
                <option value="CEILING">Luôn làm tròn lên</option>
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <strong>Công thức:</strong> công trước ngày chính thức dùng tỷ lệ thử việc; công từ ngày
            chính thức dùng 100%. Thưởng, phạt và tăng ca không bị nhân tỷ lệ thử việc.
          </div>

          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-emerald-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Áp dụng từ ngày
                <input
                  aria-label="Ngày áp dụng quy định lương"
                  onChange={(event) => setSalaryDate(event.target.value)}
                  type="date"
                  value={salaryDate}
                />
                <span className="text-xs font-normal text-slate-500">
                  Có thể chọn ngày trong quá khứ. Kỳ lương dùng rule hiệu lực của tháng đó.
                </span>
              </label>
              <Button
                disabled={
                  saving ||
                  standardDaysOff === "" ||
                  percentToBasisPoints(probationSalaryRate) === null ||
                  standardDailyMinutes === "" ||
                  overtimeMultiplier === "" ||
                  roundingUnit === "" ||
                  roundingMode === ""
                }
                onClick={() => void applySalaryRules()}
                type="button"
              >
                {saving ? "Đang lưu…" : "Lưu & áp dụng quy định lương"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">
                {statusText[rules.penalty.status]}
              </span>
              {rules.penalty.effectiveFrom
                ? ` · từ ${displayDate(rules.penalty.effectiveFrom)}`
                : " · thêm loại lỗi đầu tiên để bắt đầu"}
            </div>
            {canEdit ? (
              <Button
                onClick={() =>
                  setPenaltyRows((current) => [
                    ...current,
                    {
                      key: localKey(),
                      name: "",
                      description: "",
                      defaultAmount: "0",
                      reminderCount: 0,
                      countingWindow: "CALENDAR_MONTH",
                      displayColor: "#EF4444",
                      isActive: true,
                      automaticCondition: { type: "MANUAL" },
                    },
                  ])
                }
                type="button"
                variant="outline-danger"
              >
                + Thêm loại lỗi
              </Button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4">
            {penaltyRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                {canEdit
                  ? "Chưa có loại lỗi. Bấm “Thêm loại lỗi” để nhập."
                  : "Chưa có loại lỗi đang áp dụng."}
              </div>
            ) : (
              penaltyRows.map((row, index) => (
                <article className="rounded-xl border border-slate-200 p-4" key={row.key}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <input
                        aria-label={`Màu lỗi ${index + 1}`}
                        className="h-10 w-12 cursor-pointer p-1"
                        disabled={!canEdit}
                        onChange={(event) =>
                          updatePenalty(row.key, { displayColor: event.target.value })
                        }
                        type="color"
                        value={row.displayColor}
                      />
                      <label className="grid min-w-64 flex-1 gap-1 text-sm font-medium">
                        Tên loại lỗi
                        <input
                          aria-label={`Tên lỗi ${index + 1}`}
                          disabled={!canEdit}
                          onChange={(event) => updatePenalty(row.key, { name: event.target.value })}
                          placeholder="Ví dụ: Đi muộn"
                          value={row.name}
                        />
                      </label>
                    </div>
                    {canEdit ? (
                      <button
                        aria-label={`Xóa loại lỗi ${index + 1}`}
                        className="text-sm text-rose-700 underline underline-offset-4"
                        onClick={() =>
                          setPenaltyRows((current) =>
                            current.filter((candidate) => candidate.key !== row.key),
                          )
                        }
                        type="button"
                      >
                        Xóa
                      </button>
                    ) : null}
                  </div>

                  <label className="mt-3 grid gap-1 text-sm font-medium">
                    Nội dung / mô tả
                    <textarea
                      aria-label={`Nội dung lỗi ${index + 1}`}
                      className="min-h-20"
                      disabled={!canEdit}
                      onChange={(event) =>
                        updatePenalty(row.key, { description: event.target.value })
                      }
                      placeholder="Mô tả hành vi vi phạm để người chấm công dễ chọn đúng"
                      value={row.description}
                    />
                  </label>

                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <label className="grid gap-1 text-sm font-medium">
                      Số lần nhắc miễn phạt
                      <input
                        aria-label={`Số lần nhắc ${index + 1}`}
                        disabled={!canEdit}
                        min="0"
                        onChange={(event) =>
                          updatePenalty(row.key, {
                            reminderCount: Number(event.target.value),
                          })
                        }
                        step="1"
                        type="number"
                        value={row.reminderCount}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Tiền phạt mỗi lần
                      <input
                        aria-label={`Tiền phạt ${index + 1}`}
                        disabled={!canEdit}
                        inputMode="numeric"
                        min="0"
                        onChange={(event) =>
                          updatePenalty(row.key, { defaultAmount: event.target.value })
                        }
                        step="1000"
                        type="number"
                        value={row.defaultAmount}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Đếm số lần
                      <select
                        aria-label={`Chu kỳ đếm ${index + 1}`}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updatePenalty(row.key, {
                            countingWindow: event.target.value as PenaltyRow["countingWindow"],
                          })
                        }
                        value={row.countingWindow}
                      >
                        <option value="CALENDAR_MONTH">Làm lại từ đầu mỗi tháng</option>
                        <option value="LIFETIME">Cộng dồn toàn thời gian</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 self-end rounded-lg bg-slate-50 p-3 text-sm font-medium">
                      <input
                        checked={row.isActive}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updatePenalty(row.key, { isActive: event.target.checked })
                        }
                        type="checkbox"
                      />
                      Đang sử dụng
                    </label>
                  </div>

                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <div className="grid gap-3 lg:grid-cols-4">
                      <label className="grid gap-1 text-sm font-medium">
                        Cách ghi nhận lỗi
                        <select
                          aria-label={`Cách ghi nhận lỗi ${index + 1}`}
                          disabled={!canEdit}
                          onChange={(event) => {
                            const type = event.target.value as AutomaticPenaltyConditionDto["type"];
                            updatePenalty(row.key, {
                              automaticCondition:
                                type === "CHECK_IN_LATE"
                                  ? {
                                      type,
                                      thresholdSource: "STAFF_SHIFT",
                                      scheduledStartMinutes: 9 * 60,
                                      graceMinutes: 15,
                                      branchId: null,
                                    }
                                  : type === "LIVE_DURATION_SHORT"
                                    ? {
                                        type,
                                        thresholdSource: "STAFF_SHIFT",
                                        requiredLiveMinutes: 6 * 60,
                                        graceMinutes: 15,
                                        branchId: null,
                                      }
                                    : { type: "MANUAL" },
                            });
                          }}
                          value={row.automaticCondition.type}
                        >
                          <option value="MANUAL">Ghi thủ công</option>
                          <option value="CHECK_IN_LATE">Tự động khi check-in muộn</option>
                          <option value="LIVE_DURATION_SHORT">
                            Tự động khi thiếu thời lượng Live
                          </option>
                        </select>
                      </label>

                      {row.automaticCondition.type !== "MANUAL" ? (
                        <label className="grid gap-1 text-sm font-medium">
                          Nguồn giờ chuẩn
                          <select
                            aria-label={`Nguồn giờ chuẩn lỗi ${index + 1}`}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const condition = row.automaticCondition;
                              if (condition.type === "MANUAL") return;
                              updatePenalty(row.key, {
                                automaticCondition: {
                                  ...condition,
                                  thresholdSource: event.target.value as
                                    | "STAFF_SHIFT"
                                    | "RULE_FIXED",
                                },
                              });
                            }}
                            value={
                              row.automaticCondition.thresholdSource ?? "RULE_FIXED"
                            }
                          >
                            <option value="STAFF_SHIFT">Ca của từng nhân viên</option>
                            <option value="RULE_FIXED">Giờ cố định trong rule</option>
                          </select>
                        </label>
                      ) : null}

                      {row.automaticCondition.type === "CHECK_IN_LATE" &&
                      (row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "RULE_FIXED" ? (
                        <label className="grid gap-1 text-sm font-medium">
                          Giờ bắt đầu ca
                          <input
                            aria-label={`Giờ bắt đầu ca ${index + 1}`}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const condition = row.automaticCondition;
                              if (condition.type !== "CHECK_IN_LATE") return;
                              const minutes = timeToMinutes(event.target.value);
                              if (minutes === null || minutes > 1_439) return;
                              updatePenalty(row.key, {
                                automaticCondition: {
                                  ...condition,
                                  scheduledStartMinutes: minutes,
                                },
                              });
                            }}
                            type="time"
                            value={minutesToTime(
                              row.automaticCondition.scheduledStartMinutes ?? 9 * 60,
                            )}
                          />
                        </label>
                      ) : null}

                      {row.automaticCondition.type === "LIVE_DURATION_SHORT" &&
                      (row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "RULE_FIXED" ? (
                        <label className="grid gap-1 text-sm font-medium">
                          Thời lượng Live tiêu chuẩn
                          <input
                            aria-label={`Thời lượng Live tiêu chuẩn ${index + 1}`}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const condition = row.automaticCondition;
                              if (condition.type !== "LIVE_DURATION_SHORT") return;
                              const minutes = timeToMinutes(event.target.value);
                              if (minutes === null || minutes < 1) return;
                              updatePenalty(row.key, {
                                automaticCondition: {
                                  ...condition,
                                  requiredLiveMinutes: minutes,
                                  graceMinutes: Math.min(condition.graceMinutes, minutes),
                                },
                              });
                            }}
                            step="60"
                            type="time"
                            value={minutesToTime(
                              row.automaticCondition.requiredLiveMinutes ?? 6 * 60,
                            )}
                          />
                        </label>
                      ) : null}

                      {row.automaticCondition.type !== "MANUAL" ? (
                        <>
                          <label className="grid gap-1 text-sm font-medium">
                            Số phút du di
                            <input
                              aria-label={`Số phút du di ${index + 1}`}
                              disabled={!canEdit}
                              max={
                                row.automaticCondition.type === "LIVE_DURATION_SHORT"
                                  ? (row.automaticCondition.requiredLiveMinutes ?? 720)
                                  : 720
                              }
                              min="0"
                              onChange={(event) => {
                                const condition = row.automaticCondition;
                                if (condition.type === "MANUAL") return;
                                const value = Number(event.target.value);
                                if (!Number.isInteger(value)) return;
                                updatePenalty(row.key, {
                                  automaticCondition: {
                                    ...condition,
                                    graceMinutes: Math.max(0, value),
                                  },
                                });
                              }}
                              step="1"
                              type="number"
                              value={row.automaticCondition.graceMinutes}
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-medium">
                            Cơ sở áp dụng
                            <select
                              aria-label={`Cơ sở áp dụng lỗi ${index + 1}`}
                              disabled={!canEdit}
                              onChange={(event) => {
                                const condition = row.automaticCondition;
                                if (condition.type === "MANUAL") return;
                                updatePenalty(row.key, {
                                  automaticCondition: {
                                    ...condition,
                                    branchId: event.target.value || null,
                                  },
                                });
                              }}
                              value={row.automaticCondition.branchId ?? ""}
                            >
                              <option value="">Toàn công ty</option>
                              {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                  {branch.code} — {branch.name}
                                  {branch.isActive ? "" : " (đã ngừng)"}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : null}
                    </div>

                    {row.automaticCondition.type === "CHECK_IN_LATE" ? (
                      <p className="mt-3 break-words text-sm text-sky-900 [overflow-wrap:anywhere]">
                        {(row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "STAFF_SHIFT"
                          ? "Giờ bắt đầu lấy từ ca hiệu lực của từng nhân viên"
                          : `Ca bắt đầu ${minutesToTime(
                              row.automaticCondition.scheduledStartMinutes ?? 9 * 60,
                            )}`}
                        , du di {row.automaticCondition.graceMinutes} phút. Check-in đến{" "}
                        {(row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "RULE_FIXED" ? (
                          <strong>
                            {minutesToTime(
                              (row.automaticCondition.scheduledStartMinutes ?? 9 * 60) +
                                row.automaticCondition.graceMinutes,
                            )}
                          </strong>
                        ) : (
                          "giờ bắt đầu ca cộng số phút du di"
                        )}{" "}
                        không bị phạt; sau mốc này sẽ tự động tính lỗi.
                      </p>
                    ) : row.automaticCondition.type === "LIVE_DURATION_SHORT" ? (
                      <p className="mt-3 break-words text-sm text-sky-900 [overflow-wrap:anywhere]">
                        Yêu cầu Live{" "}
                        {(row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "STAFF_SHIFT" ? (
                          "lấy từ ca hiệu lực của từng nhân viên"
                        ) : (
                          <strong>
                            {minutesToTime(
                              row.automaticCondition.requiredLiveMinutes ?? 6 * 60,
                            )}
                          </strong>
                        )}
                        , du di {row.automaticCondition.graceMinutes} phút. Live từ{" "}
                        {(row.automaticCondition.thresholdSource ?? "RULE_FIXED") ===
                        "RULE_FIXED" ? (
                          <strong>
                            {minutesToTime(
                              Math.max(
                                0,
                                (row.automaticCondition.requiredLiveMinutes ?? 6 * 60) -
                                  row.automaticCondition.graceMinutes,
                              ),
                            )}
                          </strong>
                        ) : (
                          "thời lượng ca trừ số phút du di"
                        )}{" "}
                        được tính là đạt; thấp hơn sẽ tự động tính lỗi.
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-slate-600">
                        Quản lý chọn loại lỗi này thủ công trong hồ sơ chấm công.
                      </p>
                    )}
                  </div>

                  <div
                    className="mt-3 rounded-lg px-3 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: `${row.displayColor}14`,
                      color: row.displayColor,
                    }}
                  >
                    {row.reminderCount > 0
                      ? `Lần 1–${row.reminderCount}: nhắc nhở 0đ · từ lần ${row.reminderCount + 1}: phạt ${formatAmount(row.defaultAmount)}đ/lần`
                      : `Phạt ${formatAmount(row.defaultAmount)}đ ngay từ lần đầu`}
                  </div>
                </article>
              ))
            )}
          </div>

          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-rose-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Áp dụng từ ngày
                <input
                  aria-label="Ngày áp dụng phạt"
                  onChange={(event) => setPenaltyDate(event.target.value)}
                  type="date"
                  value={penaltyDate}
                />
                <span className="text-xs font-normal text-slate-500">
                  Có thể chọn ngày trong quá khứ. Lưu mới sẽ thay thế ngày áp dụng và quy định hiện
                  tại.
                </span>
              </label>
              <Button
                disabled={saving || penaltyRows.length === 0}
                onClick={() => void applyPenaltyRules()}
                type="button"
              >
                {saving ? "Đang lưu…" : "Lưu & áp dụng bảng phạt"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
