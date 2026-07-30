"use client";

import type {
  ConfiguredRule,
  ConfiguredRuleComparisonDto,
  ConfiguredRuleSetDto,
  ConfiguredRuleType,
  ConfiguredRuleVersionDto,
  DailyRewardConfig,
  KpiTemplateConfig,
  LevelProposalDto,
  MonthlyLevelConfig,
  PerformanceLevelOptionDto,
  RuleImpactPreviewDto,
  SalaryConfig,
} from "@ald/contracts";
import { Button } from "@ald/ui";
import { useCallback, useEffect, useRef, useState } from "react";

type ApiPayload = Readonly<{
  data?: unknown;
  error?: Readonly<{ message?: unknown }>;
}>;

const typeLabels: Readonly<Record<ConfiguredRuleType, string>> = {
  DAILY_REWARD_TIERS: "Thưởng ngày",
  MONTHLY_LEVEL_RULES: "Level & thưởng tháng",
  SALARY_RULES: "Quy tắc lương",
  KPI_TEMPLATE: "Mẫu KPI",
};

const statusLabels = {
  DRAFT: "Bản nháp",
  SCHEDULED: "Đã lên lịch",
  ACTIVE: "Đang hiệu lực",
  RETIRED: "Đã kết thúc",
} as const;

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100";

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}

function payloadError(payload: ApiPayload): string {
  return typeof payload.error?.message === "string"
    ? payload.error.message
    : "Không thể xử lý Rule Center.";
}

function DailyEditor({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: DailyRewardConfig;
  disabled: boolean;
  onChange: (value: DailyRewardConfig) => void;
}>) {
  const updateTier = (index: number, patch: Partial<DailyRewardConfig["tiers"][number]>) =>
    onChange({
      ...value,
      tiers: value.tiers.map((tier, position) =>
        position === index ? { ...tier, ...patch } : tier,
      ),
    });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        Chính sách khoảng
        <select
          className={inputClass}
          disabled={disabled}
          value={value.gapPolicy}
          onChange={(event) =>
            onChange({
              ...value,
              gapPolicy: event.target.value as DailyRewardConfig["gapPolicy"],
            })
          }
        >
          <option value="REQUIRE_CONTIGUOUS">Không cho phép gap</option>
          <option value="ALLOW_GAPS">Cho phép gap</option>
        </select>
      </label>
      <div className="overflow-x-auto">
        <table className="min-w-[1050px] text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2">Mã</th>
              <th className="p-2">Tên bậc</th>
              <th className="p-2">Từ</th>
              <th className="p-2">Gồm cận từ</th>
              <th className="p-2">Đến (trống = ∞)</th>
              <th className="p-2">Gồm cận đến</th>
              <th className="p-2">Thưởng VND</th>
              <th className="p-2">Ưu tiên</th>
              {!disabled ? <th className="p-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {value.tiers.map((tier, index) => (
              <tr className="border-t border-slate-200" key={`${tier.code}-${index}`}>
                <td className="p-1">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    value={tier.code}
                    onChange={(event) => updateTier(index, { code: event.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    value={tier.name}
                    onChange={(event) => updateTier(index, { name: event.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    inputMode="numeric"
                    value={tier.minRevenue}
                    onChange={(event) => updateTier(index, { minRevenue: event.target.value })}
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    checked={tier.minInclusive}
                    disabled={disabled}
                    type="checkbox"
                    onChange={(event) => updateTier(index, { minInclusive: event.target.checked })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    inputMode="numeric"
                    value={tier.maxRevenue ?? ""}
                    onChange={(event) =>
                      updateTier(index, { maxRevenue: event.target.value || null })
                    }
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    checked={tier.maxInclusive}
                    disabled={disabled}
                    type="checkbox"
                    onChange={(event) => updateTier(index, { maxInclusive: event.target.checked })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    inputMode="numeric"
                    value={tier.rewardAmount}
                    onChange={(event) => updateTier(index, { rewardAmount: event.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={`${inputClass} w-20`}
                    disabled={disabled}
                    type="number"
                    value={tier.priority}
                    onChange={(event) =>
                      updateTier(index, { priority: Number(event.target.value) })
                    }
                  />
                </td>
                {!disabled ? (
                  <td className="p-1">
                    <button
                      className="text-rose-700"
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          tiers: value.tiers.filter((_, position) => position !== index),
                        })
                      }
                    >
                      Xóa
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <Button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              tiers: [
                ...value.tiers,
                {
                  code: `T${value.tiers.length + 1}`,
                  name: `Bậc ${value.tiers.length + 1}`,
                  minRevenue: "0",
                  maxRevenue: null,
                  minInclusive: true,
                  maxInclusive: false,
                  rewardAmount: "0",
                  priority: value.tiers.length,
                },
              ],
            })
          }
        >
          Thêm bậc
        </Button>
      ) : null}
    </div>
  );
}

function MonthlyEditor({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: MonthlyLevelConfig;
  disabled: boolean;
  onChange: (value: MonthlyLevelConfig) => void;
}>) {
  const updateLevel = (index: number, patch: Partial<MonthlyLevelConfig["levels"][number]>) =>
    onChange({
      ...value,
      levels: value.levels.map((level, position) =>
        position === index ? { ...level, ...patch } : level,
      ),
    });
  const textColumns: readonly Readonly<{
    key:
      | "code"
      | "name"
      | "minRevenue"
      | "maxRevenue"
      | "monthlyRevenueBonus"
      | "attendanceBonus"
      | "achievementBonus"
      | "retainLevelBonus"
      | "jumpLevelBonus"
      | "attendanceMinWorkUnits";
    label: string;
  }>[] = [
    { key: "code", label: "Mã" },
    { key: "name", label: "Tên" },
    { key: "minRevenue", label: "Mốc xu từ" },
    { key: "maxRevenue", label: "Mốc xu đến" },
    { key: "monthlyRevenueBonus", label: "Thưởng xu tháng (cũ)" },
    { key: "attendanceBonus", label: "Thưởng chuyên cần" },
    { key: "achievementBonus", label: "Thưởng thành tích" },
    { key: "retainLevelBonus", label: "Thưởng giữ level" },
    { key: "jumpLevelBonus", label: "Thưởng nhảy level" },
    { key: "attendanceMinWorkUnits", label: "Công tối thiểu" },
  ];
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        Chính sách khoảng
        <select
          className={inputClass}
          disabled={disabled}
          value={value.gapPolicy}
          onChange={(event) =>
            onChange({
              ...value,
              gapPolicy: event.target.value as MonthlyLevelConfig["gapPolicy"],
            })
          }
        >
          <option value="REQUIRE_CONTIGUOUS">Không cho phép gap</option>
          <option value="ALLOW_GAPS">Cho phép gap</option>
        </select>
      </label>
      <div className="overflow-x-auto">
        <table className="min-w-[2200px] text-left text-xs">
          <thead className="bg-slate-100">
            <tr>
              {textColumns.map((column) => (
                <th className="p-2" key={column.key}>
                  {column.label}
                </th>
              ))}
              <th className="p-2">Thứ tự</th>
              <th className="p-2">Cận từ đóng</th>
              <th className="p-2">Cận đến đóng</th>
              <th className="p-2">Live tối thiểu</th>
              <th className="p-2">Bước nhảy</th>
              {!disabled ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {value.levels.map((level, index) => (
              <tr className="border-t border-slate-200" key={`${level.code}-${index}`}>
                {textColumns.map((column) => (
                  <td className="p-1" key={column.key}>
                    <input
                      className={`${inputClass} w-32`}
                      disabled={disabled}
                      value={level[column.key] ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          [column.key]:
                            (column.key === "maxRevenue" ||
                              column.key === "attendanceMinWorkUnits") &&
                            !event.target.value
                              ? null
                              : event.target.value,
                        })
                      }
                    />
                  </td>
                ))}
                <td className="p-1">
                  <input
                    className={`${inputClass} w-20`}
                    disabled={disabled}
                    type="number"
                    value={level.displayOrder}
                    onChange={(event) =>
                      updateLevel(index, { displayOrder: Number(event.target.value) })
                    }
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    checked={level.minInclusive}
                    disabled={disabled}
                    type="checkbox"
                    onChange={(event) => updateLevel(index, { minInclusive: event.target.checked })}
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    checked={level.maxInclusive}
                    disabled={disabled}
                    type="checkbox"
                    onChange={(event) => updateLevel(index, { maxInclusive: event.target.checked })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className={`${inputClass} w-28`}
                    disabled={disabled}
                    type="number"
                    value={level.achievementMinLiveMinutes ?? ""}
                    onChange={(event) =>
                      updateLevel(index, {
                        achievementMinLiveMinutes: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </td>
                <td className="p-1">
                  <input
                    className={`${inputClass} w-20`}
                    disabled={disabled}
                    type="number"
                    value={level.jumpMinLevelSteps}
                    onChange={(event) =>
                      updateLevel(index, {
                        jumpMinLevelSteps: Number(event.target.value),
                      })
                    }
                  />
                </td>
                {!disabled ? (
                  <td className="p-1">
                    <button
                      className="text-rose-700"
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          levels: value.levels.filter((_, position) => position !== index),
                        })
                      }
                    >
                      Xóa
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <Button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              levels: [
                ...value.levels,
                {
                  code: `L${value.levels.length + 1}`,
                  name: `Level ${value.levels.length + 1}`,
                  displayOrder: value.levels.length + 1,
                  minRevenue: "0",
                  maxRevenue: null,
                  minInclusive: true,
                  maxInclusive: false,
                  monthlyRevenueBonus: "0",
                  attendanceBonus: "0",
                  achievementBonus: "0",
                  retainLevelBonus: "0",
                  jumpLevelBonus: "0",
                  attendanceMinWorkUnits: null,
                  achievementMinLiveMinutes: null,
                  jumpMinLevelSteps: 2,
                },
              ],
            })
          }
        >
          Thêm level
        </Button>
      ) : null}
    </div>
  );
}

function SalaryEditor({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: SalaryConfig;
  disabled: boolean;
  onChange: (value: SalaryConfig) => void;
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <label className="text-sm">
        Lương cơ bản (VND)
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.baseSalary}
          onChange={(event) => onChange({ ...value, baseSalary: event.target.value })}
        />
      </label>
      <label className="text-sm">
        Ngày công chuẩn
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.standardWorkdays}
          onChange={(event) => onChange({ ...value, standardWorkdays: event.target.value })}
        />
      </label>
      <label className="text-sm">
        Tỷ lệ lương thử việc (%)
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          max={100}
          min={0}
          step="0.01"
          type="number"
          value={(value.probationSalaryRateBps ?? 8_500) / 100}
          onChange={(event) =>
            onChange({
              ...value,
              probationSalaryRateBps: Math.round(Number(event.target.value) * 100),
            })
          }
        />
      </label>
      <label className="text-sm">
        Phút/ngày chuẩn
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          type="number"
          value={value.standardDailyMinutes}
          onChange={(event) =>
            onChange({ ...value, standardDailyMinutes: Number(event.target.value) })
          }
        />
      </label>
      <label className="text-sm">
        Hệ số OT (basis points; 15000 = 1,5x)
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          type="number"
          value={value.overtime.multiplierBps}
          onChange={(event) =>
            onChange({
              ...value,
              overtime: { ...value.overtime, multiplierBps: Number(event.target.value) },
            })
          }
        />
      </label>
      <label className="text-sm">
        OT miễn trừ mỗi ngày (phút)
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          type="number"
          value={value.overtime.eligibleAfterMinutes}
          onChange={(event) =>
            onChange({
              ...value,
              overtime: {
                ...value.overtime,
                eligibleAfterMinutes: Number(event.target.value),
              },
            })
          }
        />
      </label>
      <label className="text-sm">
        Prorate
        <select
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.attendancePolicy.prorateMode}
          onChange={(event) =>
            onChange({
              ...value,
              attendancePolicy: {
                ...value.attendancePolicy,
                prorateMode: event.target.value as SalaryConfig["attendancePolicy"]["prorateMode"],
              },
            })
          }
        >
          <option value="WORK_UNITS">Theo số công</option>
          <option value="PRESENT_DAYS">Theo ngày hiện diện</option>
        </select>
      </label>
      <label className="text-sm">
        Công đủ lương (trống = không áp dụng)
        <input
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.attendancePolicy.minimumWorkUnitsForFullSalary ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              attendancePolicy: {
                ...value.attendancePolicy,
                minimumWorkUnitsForFullSalary: event.target.value || null,
              },
            })
          }
        />
      </label>
      <label className="text-sm">
        Đơn vị làm tròn
        <select
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.roundingPolicy.unit}
          onChange={(event) =>
            onChange({
              ...value,
              roundingPolicy: {
                ...value.roundingPolicy,
                unit: Number(event.target.value) as SalaryConfig["roundingPolicy"]["unit"],
              },
            })
          }
        >
          {[1, 10, 100, 1000].map((unit) => (
            <option key={unit} value={unit}>
              {unit.toLocaleString("vi-VN")} VND
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Cách làm tròn
        <select
          className={`${inputClass} mt-1 w-full`}
          disabled={disabled}
          value={value.roundingPolicy.mode}
          onChange={(event) =>
            onChange({
              ...value,
              roundingPolicy: {
                ...value.roundingPolicy,
                mode: event.target.value as SalaryConfig["roundingPolicy"]["mode"],
              },
            })
          }
        >
          <option value="HALF_UP">Half up</option>
          <option value="HALF_EVEN">Half even</option>
          <option value="FLOOR">Xuống</option>
          <option value="CEILING">Lên</option>
        </select>
      </label>
      <fieldset className="rounded-lg border border-slate-200 p-3 text-sm md:col-span-3">
        <legend>Trạng thái được tính</legend>
        <div className="flex flex-wrap gap-4">
          {(["DRAFT", "PRESENT", "ABSENT", "LEAVE"] as const).map((status) => (
            <label className="flex items-center gap-1" key={status}>
              <input
                checked={value.attendancePolicy.eligibleStatuses.includes(status)}
                disabled={disabled}
                type="checkbox"
                onChange={(event) =>
                  onChange({
                    ...value,
                    attendancePolicy: {
                      ...value.attendancePolicy,
                      eligibleStatuses: event.target.checked
                        ? [...value.attendancePolicy.eligibleStatuses, status]
                        : value.attendancePolicy.eligibleStatuses.filter(
                            (candidate) => candidate !== status,
                          ),
                    },
                  })
                }
              />
              {status}
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input
              checked={value.attendancePolicy.capAtStandardWorkdays}
              disabled={disabled}
              type="checkbox"
              onChange={(event) =>
                onChange({
                  ...value,
                  attendancePolicy: {
                    ...value.attendancePolicy,
                    capAtStandardWorkdays: event.target.checked,
                  },
                })
              }
            />
            Giới hạn ở công chuẩn
          </label>
          <label>
            Làm tròn tại{" "}
            <select
              className={inputClass}
              disabled={disabled}
              value={value.roundingPolicy.applyAt}
              onChange={(event) =>
                onChange({
                  ...value,
                  roundingPolicy: {
                    ...value.roundingPolicy,
                    applyAt: event.target.value as SalaryConfig["roundingPolicy"]["applyAt"],
                  },
                })
              }
            >
              <option value="COMPONENT">Từng thành phần</option>
              <option value="TOTAL">Tổng cuối</option>
            </select>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

function KpiEditor({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: KpiTemplateConfig;
  disabled: boolean;
  onChange: (value: KpiTemplateConfig) => void;
}>) {
  const update = (index: number, patch: Partial<KpiTemplateConfig["criteria"][number]>) =>
    onChange({
      ...value,
      criteria: value.criteria.map((criterion, position) =>
        position === index ? { ...criterion, ...patch } : criterion,
      ),
    });
  return (
    <div className="space-y-3 overflow-x-auto">
      <table className="min-w-[1250px] text-left text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="p-2">Mã</th>
            <th className="p-2">Tiêu chí</th>
            <th className="p-2">Mô tả</th>
            <th className="p-2">Trọng số (bps)</th>
            <th className="p-2">Điểm tối đa</th>
            <th className="p-2">Bắt buộc evidence</th>
            <th className="p-2">Bắt buộc note</th>
            <th className="p-2">Thứ tự</th>
            {!disabled ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {value.criteria.map((criterion, index) => (
            <tr className="border-t border-slate-200" key={`${criterion.code}-${index}`}>
              {(["code", "name", "description"] as const).map((key) => (
                <td className="p-1" key={key}>
                  <input
                    className={`${inputClass} w-44`}
                    disabled={disabled}
                    value={criterion[key]}
                    onChange={(event) => update(index, { [key]: event.target.value })}
                  />
                </td>
              ))}
              {(["weightBps", "maxScore"] as const).map((key) => (
                <td className="p-1" key={key}>
                  <input
                    className={`${inputClass} w-28`}
                    disabled={disabled}
                    type="number"
                    value={criterion[key]}
                    onChange={(event) => update(index, { [key]: Number(event.target.value) })}
                  />
                </td>
              ))}
              {(["requiredEvidence", "requiredNote"] as const).map((key) => (
                <td className="p-1 text-center" key={key}>
                  <input
                    checked={criterion[key]}
                    disabled={disabled}
                    type="checkbox"
                    onChange={(event) => update(index, { [key]: event.target.checked })}
                  />
                </td>
              ))}
              <td className="p-1">
                <input
                  className={`${inputClass} w-20`}
                  disabled={disabled}
                  type="number"
                  value={criterion.displayOrder}
                  onChange={(event) => update(index, { displayOrder: Number(event.target.value) })}
                />
              </td>
              {!disabled ? (
                <td className="p-1">
                  <button
                    className="text-rose-700"
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        criteria: value.criteria.filter((_, position) => position !== index),
                      })
                    }
                  >
                    Xóa
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!disabled ? (
        <Button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              criteria: [
                ...value.criteria,
                {
                  code: `KPI_${value.criteria.length + 1}`,
                  name: `Tiêu chí ${value.criteria.length + 1}`,
                  description: "",
                  weightBps: 0,
                  maxScore: 100,
                  requiredEvidence: false,
                  requiredNote: false,
                  displayOrder: value.criteria.length,
                },
              ],
            })
          }
        >
          Thêm tiêu chí
        </Button>
      ) : null}
    </div>
  );
}

function ConfigEditor({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: ConfiguredRule;
  disabled: boolean;
  onChange: (value: ConfiguredRule) => void;
}>) {
  if (value.kind === "DAILY_REWARD_TIERS") {
    return <DailyEditor disabled={disabled} value={value} onChange={onChange} />;
  }
  if (value.kind === "MONTHLY_LEVEL_RULES") {
    return <MonthlyEditor disabled={disabled} value={value} onChange={onChange} />;
  }
  if (value.kind === "SALARY_RULES") {
    return <SalaryEditor disabled={disabled} value={value} onChange={onChange} />;
  }
  return <KpiEditor disabled={disabled} value={value} onChange={onChange} />;
}

export function ConfiguredRuleCenter({
  isGeneralManager,
}: Readonly<{ isGeneralManager: boolean }>) {
  const [sets, setSets] = useState<readonly ConfiguredRuleSetDto[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [configuration, setConfiguration] = useState<ConfiguredRule | null>(null);
  const [notes, setNotes] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [impact, setImpact] = useState<RuleImpactPreviewDto | null>(null);
  const [comparison, setComparison] = useState<ConfiguredRuleComparisonDto | null>(null);
  const [proposals, setProposals] = useState<readonly LevelProposalDto[]>([]);
  const [levelOptions, setLevelOptions] = useState<readonly PerformanceLevelOptionDto[]>([]);
  const [overrides, setOverrides] = useState<Readonly<Record<string, string>>>({});
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ConfiguredRuleType>("DAILY_REWARD_TIERS");
  const selectedVersionIdRef = useRef("");

  const versions = sets.flatMap((set) => set.versions);
  const selected = versions.find((version) => version.id === selectedVersionId);
  const selectedSet = sets.find((set) => set.id === selected?.ruleSetId);
  const editable = isGeneralManager && selected?.status === "DRAFT";

  const selectVersion = useCallback((next: ConfiguredRuleVersionDto | undefined) => {
    selectedVersionIdRef.current = next?.id ?? "";
    setSelectedVersionId(next?.id ?? "");
    setConfiguration(next ? structuredClone(next.configuration) : null);
    setNotes(next?.notes ?? "");
    setImpact(null);
    setComparison(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/rules/configured", { cache: "no-store" });
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setMessage(payloadError(payload));
      setLoading(false);
      return;
    }
    const next = payload.data as readonly ConfiguredRuleSetDto[];
    setSets(next);
    selectVersion(
      next
        .flatMap((set) => set.versions)
        .find((version) => version.id === selectedVersionIdRef.current) ??
        next.flatMap((set) => set.versions)[0],
    );
    setLoading(false);
  }, [selectVersion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function request(path: string, method: "POST" | "PATCH", body: unknown) {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok) throw new Error(payloadError(payload));
    return payload.data;
  }

  async function run(action: () => Promise<void>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể xử lý yêu cầu.");
    }
  }

  async function reloadProposals() {
    const [proposalResponse, levelResponse] = await Promise.all([
      fetch(`/api/rules/configured/level-proposals?month=${encodeURIComponent(month)}`, {
        cache: "no-store",
      }),
      fetch("/api/rules/configured/levels", { cache: "no-store" }),
    ]);
    const [proposalPayload, levelPayload] = (await Promise.all([
      proposalResponse.json(),
      levelResponse.json(),
    ])) as [ApiPayload, ApiPayload];
    if (!proposalResponse.ok) throw new Error(payloadError(proposalPayload));
    if (!levelResponse.ok) throw new Error(payloadError(levelPayload));
    setProposals(proposalPayload.data as readonly LevelProposalDto[]);
    setLevelOptions(levelPayload.data as readonly PerformanceLevelOptionDto[]);
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Rule Center — thưởng, level, lương & KPI</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cấu hình có kiểu, version bất biến sau publish và khoảng hiệu lực [từ, đến).
          </p>
        </div>
        {!isGeneralManager ? (
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-800">
            Chỉ xem rule đang hiệu lực
          </span>
        ) : null}
      </div>

      {message ? (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>
      ) : null}

      {isGeneralManager ? (
        <div className="mt-5 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
          <label className="text-sm">
            Loại rule
            <select
              className={`${inputClass} mt-1 block`}
              value={newType}
              onChange={(event) => setNewType(event.target.value as ConfiguredRuleType)}
            >
              {Object.entries(typeLabels).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-64 flex-1 text-sm">
            Tên bộ rule mới
            <input
              className={`${inputClass} mt-1 w-full`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={() =>
              void run(async () => {
                const created = (await request("/api/rules/configured", "POST", {
                  type: newType,
                  name: newName,
                })) as ConfiguredRuleSetDto;
                setNewName("");
                setMessage("Đã tạo bộ rule và draft v1.");
                await load();
                selectVersion(created.versions[0]);
              })
            }
          >
            Tạo bộ rule
          </Button>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_2fr]">
        <label className="text-sm">
          Version
          <select
            className={`${inputClass} mt-1 w-full`}
            disabled={loading}
            value={selectedVersionId}
            onChange={(event) =>
              selectVersion(versions.find((version) => version.id === event.target.value))
            }
          >
            {sets.flatMap((set) =>
              set.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {typeLabels[set.type]} · {set.name} · v{version.versionNo} ·{" "}
                  {statusLabels[version.effectiveStatus]}
                </option>
              )),
            )}
          </select>
        </label>
        <label className="text-sm">
          Ghi chú version
          <input
            className={`${inputClass} mt-1 w-full`}
            disabled={!editable}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>

      {configuration && selected ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <strong className="text-slate-900">{selectedSet?.name}</strong>
            <span>v{selected.versionNo}</span>
            <span>· {statusLabels[selected.effectiveStatus]}</span>
            <span>
              · {selected.effectiveFrom ?? "chưa publish"} → {selected.effectiveTo ?? "∞"}
            </span>
          </div>
          <ConfigEditor disabled={!editable} value={configuration} onChange={setConfiguration} />
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-500">
          {loading ? "Đang tải rule…" : "Chưa có rule phù hợp."}
        </p>
      )}

      {isGeneralManager && selected ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="text-sm">
              Hiệu lực từ
              <input
                className={`${inputClass} mt-1 w-full`}
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Hiệu lực đến (exclusive)
              <input
                className={`${inputClass} mt-1 w-full`}
                type="date"
                value={effectiveTo}
                onChange={(event) => setEffectiveTo(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && configuration ? (
              <>
                <Button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const updated = (await request(
                        `/api/rules/configured/versions/${selected.id}`,
                        "PATCH",
                        {
                          configuration,
                          notes: notes || null,
                          rowVersion: selected.rowVersion,
                        },
                      )) as ConfiguredRuleVersionDto;
                      setMessage("Đã lưu draft.");
                      await load();
                      selectVersion(updated);
                    })
                  }
                >
                  Lưu draft
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await request(
                        `/api/rules/configured/versions/${selected.id}/publish`,
                        "POST",
                        {
                          effectiveFrom,
                          effectiveTo: effectiveTo || null,
                          rowVersion: selected.rowVersion,
                        },
                      );
                      setMessage("Đã publish/lên lịch version.");
                      await load();
                    })
                  }
                >
                  Publish
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              onClick={() =>
                void run(async () => {
                  const draft = (await request("/api/rules/configured/drafts", "POST", {
                    ruleSetId: selected.ruleSetId,
                    cloneFromVersionId: selected.id,
                    notes: selected.notes,
                  })) as ConfiguredRuleVersionDto;
                  setMessage("Đã clone thành draft mới.");
                  await load();
                  selectVersion(draft);
                })
              }
            >
              Clone draft
            </Button>
            {selected.status === "ACTIVE" || selected.status === "SCHEDULED" ? (
              <Button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await request(`/api/rules/configured/versions/${selected.id}/retire`, "POST", {
                      effectiveTo: effectiveTo,
                      rowVersion: selected.rowVersion,
                    });
                    setMessage("Đã kết thúc version.");
                    await load();
                  })
                }
              >
                Retire
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {isGeneralManager && selected?.status === "DRAFT" ? (
        <div className="mt-5 rounded-xl bg-sky-50 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Tháng dữ liệu lịch sử
              <input
                className={`${inputClass} mt-1 block`}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <Button
              type="button"
              onClick={() =>
                void run(async () => {
                  setImpact(
                    (await request("/api/rules/configured/impact-preview", "POST", {
                      ruleVersionId: selected.id,
                      month,
                    })) as RuleImpactPreviewDto,
                  );
                })
              }
            >
              Xem tác động draft
            </Button>
            {selectedSet && selectedSet.versions.length > 1 ? (
              <Button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const previous = selectedSet.versions.find(
                      (version) => version.id !== selected.id,
                    );
                    if (!previous) return;
                    const response = await fetch(
                      `/api/rules/configured/compare?fromVersionId=${previous.id}&toVersionId=${selected.id}`,
                      { cache: "no-store" },
                    );
                    const payload = (await response.json()) as ApiPayload;
                    if (!response.ok) throw new Error(payloadError(payload));
                    setComparison(payload.data as ConfiguredRuleComparisonDto);
                  })
                }
              >
                So sánh version
              </Button>
            ) : null}
          </div>
          {impact ? (
            <div className="mt-4 overflow-x-auto">
              <p className="text-sm font-medium">
                Tổng hiện hành: {impact.totals.baselineValue} · Draft: {impact.totals.draftValue} ·
                Chênh lệch: {impact.totals.delta}
              </p>
              <table className="mt-2 min-w-full text-sm">
                <thead>
                  <tr className="border-b border-sky-200 text-left">
                    <th className="p-2">Nhân viên</th>
                    <th className="p-2">Hiện hành</th>
                    <th className="p-2">Draft</th>
                    <th className="p-2">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.rows.map((row) => (
                    <tr className="border-b border-sky-100" key={row.staffId}>
                      <td className="p-2">
                        {row.staffCode} · {row.fullName}
                      </td>
                      <td className="p-2">{row.baselineValue}</td>
                      <td className="p-2">{row.draftValue}</td>
                      <td className="p-2">{row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {comparison ? (
            <p className="mt-3 text-sm">
              Trường thay đổi: {comparison.changedPaths.join(", ") || "Không đổi"}
            </p>
          ) : null}
        </div>
      ) : null}

      {isGeneralManager ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold">Đề xuất level tháng</h3>
          <p className="mt-1 text-sm text-slate-600">
            Level được xác nhận có hiệu lực từ ngày đầu tháng kế tiếp.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              className={inputClass}
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <Button
              type="button"
              onClick={() =>
                void run(async () => {
                  await request("/api/rules/configured/level-proposals/generate", "POST", { month });
                  await reloadProposals();
                  setMessage("Đã tạo đề xuất level.");
                })
              }
            >
              Tạo đề xuất
            </Button>
            <Button type="button" onClick={() => void run(reloadProposals)}>
              Tải danh sách
            </Button>
          </div>
          {proposals.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[900px] text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2">Nhân viên</th>
                    <th className="p-2">Tổng xu</th>
                    <th className="p-2">Đề xuất</th>
                    <th className="p-2">Hiệu lực</th>
                    <th className="p-2">Trạng thái</th>
                    <th className="p-2">Override level (tùy chọn)</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((proposal) => (
                    <tr className="border-t border-slate-200" key={proposal.id}>
                      <td className="p-2">
                        {proposal.staff.staffCode} · {proposal.staff.fullName}
                      </td>
                      <td className="p-2">{proposal.monthlyRevenue}</td>
                      <td className="p-2">
                        {proposal.suggestedLevel.code} · {proposal.suggestedLevel.name}
                      </td>
                      <td className="p-2">{proposal.effectiveFrom}</td>
                      <td className="p-2">{proposal.status}</td>
                      <td className="p-2">
                        <select
                          className={`${inputClass} w-full`}
                          disabled={proposal.status !== "PENDING"}
                          value={overrides[proposal.id] ?? ""}
                          onChange={(event) =>
                            setOverrides({ ...overrides, [proposal.id]: event.target.value })
                          }
                        >
                          <option value="">Xác nhận level đề xuất</option>
                          {levelOptions.map((level) => (
                            <option key={level.id} value={level.id}>
                              {level.code} · {level.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        {proposal.status === "PENDING" ? (
                          <Button
                            type="button"
                            onClick={() =>
                              void run(async () => {
                                await request(
                                  `/api/rules/configured/level-proposals/${proposal.id}/confirm`,
                                  "POST",
                                  {
                                    version: proposal.version,
                                    performanceLevelId: overrides[proposal.id] || null,
                                  },
                                );
                                await reloadProposals();
                              })
                            }
                          >
                            Xác nhận
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
