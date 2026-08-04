export const AUTH_ROLES = ["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"] as const;

export {
  evaluateAutomaticPenalty,
  formatDurationForRule,
  type AutomaticPenaltyCondition,
  type AutomaticPenaltyEvaluation,
} from "./automatic-penalties.js";

export {
  branchAbbreviationFromCode,
  formatGeneratedStaffCode,
  nextStaffCodeSequence,
  suggestStaffCode,
  type StaffCodeSuggestion,
} from "./staff-code.js";

export type AuthRole = (typeof AUTH_ROLES)[number];

export type ActorContext = Readonly<{
  userId: string;
  companyId: string;
  staffId: string | null;
  role: AuthRole;
  activeBranchIds: readonly string[];
  canManagePayroll?: boolean;
  name?: string;
  username?: string | null;
  mustChangePassword?: boolean;
  twoFactorEnabled?: boolean;
}>;

export type ResourceAction =
  | "branch:create"
  | "branch:update"
  | "staff:create"
  | "staff:onboard"
  | "staff-profile:update"
  | "staff:update"
  | "staff-schedule:read"
  | "staff-schedule:write"
  | "staff-identity-document:read"
  | "staff-identity-document:write"
  | "staff-bank-qr:read"
  | "staff-bank-qr:write"
  | "user:create"
  | "user:update"
  | "assignment:create"
  | "assignment:update"
  | "branch:read"
  | "staff:read"
  | "attendance:read"
  | "attendance:write"
  | "attendance:export"
  | "rule:read"
  | "rule:write"
  | "violation:read"
  | "violation:write"
  | "violation:cancel"
  | "evidence:upload"
  | "evidence:read"
  | "branch-overview:read"
  | "branch-overview:write"
  | "branch-overview:export"
  | "payroll:read"
  | "payroll:write"
  | "payroll:export"
  | "payslip:read"
  | "company-report:read"
  | "company-report:export"
  | "company-dashboard:read"
  | "manager-kpi:read"
  | "manager-kpi:write"
  | "import:read"
  | "import:write"
  | "export-center:read"
  | "export-center:write"
  | "audit:read"
  | "audit:export"
  | "company-settings:update";

const GM_MUTATIONS = new Set<ResourceAction>([
  "branch:create",
  "branch:update",
  "staff:create",
  "staff:update",
  "user:create",
  "user:update",
  "assignment:create",
  "assignment:update",
]);

export function can(actor: ActorContext, action: ResourceAction): boolean {
  if (actor.role === "GENERAL_MANAGER") {
    return true;
  }

  if (GM_MUTATIONS.has(action)) {
    return false;
  }

  if (actor.role === "TRAINING_MANAGER") {
    return (
      action === "branch:read" ||
      action === "staff:read" ||
      action === "staff:onboard" ||
      action === "staff-profile:update" ||
      action === "staff-schedule:read" ||
      action === "staff-schedule:write" ||
      action === "staff-identity-document:read" ||
      action === "staff-identity-document:write" ||
      action === "staff-bank-qr:read" ||
      action === "staff-bank-qr:write" ||
      action === "attendance:read" ||
      action === "attendance:write" ||
      action === "attendance:export" ||
      action === "rule:read" ||
      action === "violation:read" ||
      action === "violation:write" ||
      action === "violation:cancel" ||
      action === "evidence:upload" ||
      action === "evidence:read" ||
      action === "branch-overview:read" ||
      action === "company-report:read" ||
      action === "manager-kpi:read"
    );
  }

  if (actor.role === "LIVE_EMPLOYEE") {
    return action === "rule:read" || action === "payslip:read";
  }

  return false;
}

export function canAccessBranch(actor: ActorContext, branchId: string): boolean {
  return (
    actor.role === "GENERAL_MANAGER" ||
    (actor.role === "TRAINING_MANAGER" && actor.activeBranchIds.includes(branchId))
  );
}

export class DomainError extends Error {
  public constructor(
    public readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "ACCOUNT_DISABLED"
      | "RATE_LIMITED"
      | "DEPENDENCY_UNAVAILABLE"
      | "ATTENDANCE_BATCH_BUSY"
      | "ATTENDANCE_BATCH_CONFLICT"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION_ERROR",
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requirePermission(actor: ActorContext, action: ResourceAction): void {
  if (!can(actor, action)) {
    throw new DomainError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
  }
}

export type AttendanceValues = Readonly<{
  businessDate: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  spansNextDay?: boolean;
  workUnits?: string;
  overtimeMinutes?: number;
  actualLiveMinutes?: number;
  revenueAmount?: string;
}>;

function calendarDateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) {
    throw new DomainError("VALIDATION_ERROR", "Không thể xác định ngày nghiệp vụ.");
  }
  return `${year}-${month}-${day}`;
}

export function toBusinessDateString(timestamp: Date, timeZone = "Asia/Ho_Chi_Minh"): string {
  return calendarDateInTimeZone(timestamp, timeZone);
}

function followingDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function validateAttendanceValues(
  input: AttendanceValues,
  timeZone = "Asia/Ho_Chi_Minh",
): void {
  const checkIn = input.checkInAt ? new Date(input.checkInAt) : null;
  const checkOut = input.checkOutAt ? new Date(input.checkOutAt) : null;

  if (checkIn && Number.isNaN(checkIn.getTime())) {
    throw new DomainError("VALIDATION_ERROR", "Giờ check-in không hợp lệ.");
  }
  if (checkOut && Number.isNaN(checkOut.getTime())) {
    throw new DomainError("VALIDATION_ERROR", "Giờ check-out không hợp lệ.");
  }
  if (checkOut && !checkIn) {
    throw new DomainError("VALIDATION_ERROR", "Phải có giờ check-in trước giờ check-out.");
  }

  if (checkIn && calendarDateInTimeZone(checkIn, timeZone) !== input.businessDate) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Giờ check-in phải thuộc đúng ngày nghiệp vụ tại Asia/Ho_Chi_Minh.",
    );
  }

  if (checkIn && checkOut) {
    if (checkOut <= checkIn) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Giờ check-out phải sau check-in; ca qua ngày phải gửi timestamp ngày kế tiếp.",
      );
    }

    const checkoutDate = calendarDateInTimeZone(checkOut, timeZone);
    const nextDate = followingDate(input.businessDate);
    if (checkoutDate !== input.businessDate && checkoutDate !== nextDate) {
      throw new DomainError("VALIDATION_ERROR", "Ca làm không được kéo dài quá ngày kế tiếp.");
    }
    if (checkoutDate === nextDate && !input.spansNextDay) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Check-out qua ngày phải được đánh dấu là ca qua ngày.",
      );
    }
    if (checkOut.getTime() - checkIn.getTime() > 36 * 60 * 60 * 1_000) {
      throw new DomainError("VALIDATION_ERROR", "Thời lượng ca không được vượt quá 36 giờ.");
    }
  }

  if (input.workUnits !== undefined) {
    const workUnits = Number(input.workUnits);
    if (!Number.isFinite(workUnits) || workUnits < 0 || workUnits > 10) {
      throw new DomainError("VALIDATION_ERROR", "Số công phải nằm trong khoảng từ 0 đến 10.");
    }
  }

  if (input.overtimeMinutes !== undefined && input.overtimeMinutes < 0) {
    throw new DomainError("VALIDATION_ERROR", "Phút tăng ca không được âm.");
  }
  if (input.actualLiveMinutes !== undefined && input.actualLiveMinutes < 0) {
    throw new DomainError("VALIDATION_ERROR", "Phút Live thực tế không được âm.");
  }
  if (input.revenueAmount !== undefined && BigInt(input.revenueAmount) < 0n) {
    throw new DomainError("VALIDATION_ERROR", "Doanh số không được âm.");
  }
}

export type BusinessMonthDay = Readonly<{
  businessDate: string;
  dayOfWeek: number;
}>;

export function enumerateBusinessMonth(month: string): readonly BusinessMonthDay[] {
  if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new DomainError("VALIDATION_ERROR", "Tháng phải có định dạng YYYY-MM.");
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const dayCount = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, index + 1));
    return {
      businessDate: date.toISOString().slice(0, 10),
      dayOfWeek: date.getUTCDay(),
    };
  });
}

export type EffectiveRuleStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "RETIRED";

export function isDateInEffectiveInterval(
  date: string,
  effectiveFrom: string,
  effectiveTo: string | null,
): boolean {
  return date >= effectiveFrom && (!effectiveTo || date < effectiveTo);
}

export function effectiveRuleStatus(
  storedStatus: EffectiveRuleStatus,
  date: string,
  effectiveFrom: string | null,
  effectiveTo: string | null,
): EffectiveRuleStatus {
  if (storedStatus === "DRAFT" || !effectiveFrom) return "DRAFT";
  if (date < effectiveFrom) return "SCHEDULED";
  if (effectiveTo && date >= effectiveTo) return "RETIRED";
  return "ACTIVE";
}

export function effectiveIntervalsOverlap(
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string | null,
): boolean {
  return (!rightTo || leftFrom < rightTo) && (!leftTo || rightFrom < leftTo);
}

export function sumPenaltyAmounts(amounts: readonly string[]): string {
  return amounts.reduce((total, amount) => total + BigInt(amount), 0n).toString();
}

export function effectivePenaltyAmount(
  calculatedAmount: string,
  overrideAmount: string | null | undefined,
): string {
  return overrideAmount === null || overrideAmount === undefined
    ? BigInt(calculatedAmount).toString()
    : BigInt(overrideAmount).toString();
}

export type MonthlyMetricValues = Readonly<{
  revenueAmount: string;
  workUnits: string;
  actualLiveMinutes: number;
  overtimeMinutes: number;
  penaltyAmount: string;
}>;

function decimalHundredths(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new DomainError("VALIDATION_ERROR", "Số công phải có tối đa 2 chữ số thập phân.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function hundredthsDecimal(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function summarizeMonthlyMetrics(
  values: readonly MonthlyMetricValues[],
): MonthlyMetricValues {
  return {
    revenueAmount: values
      .reduce((total, value) => total + BigInt(value.revenueAmount), 0n)
      .toString(),
    workUnits: hundredthsDecimal(
      values.reduce((total, value) => total + decimalHundredths(value.workUnits), 0n),
    ),
    actualLiveMinutes: values.reduce((total, value) => total + value.actualLiveMinutes, 0),
    overtimeMinutes: values.reduce((total, value) => total + value.overtimeMinutes, 0),
    penaltyAmount: values
      .reduce((total, value) => total + BigInt(value.penaltyAmount), 0n)
      .toString(),
  };
}

export function weekOfMonth(businessDate: string): number {
  const day = Number(businessDate.slice(8, 10));
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new DomainError("VALIDATION_ERROR", "Ngày nghiệp vụ không hợp lệ.");
  }
  return Math.ceil(day / 7);
}

export type BusinessCalendarWeek = Readonly<{
  weekNo: number;
  from: string;
  to: string;
  dates: readonly string[];
}>;

/**
 * Calendar/business weeks start on Monday and are clipped to the selected
 * month. The first and last week may therefore be partial.
 */
export function enumerateBusinessWeeks(month: string): readonly BusinessCalendarWeek[] {
  const days = enumerateBusinessMonth(month);
  const first = days[0];
  if (!first) return [];
  const mondayOffset = (first.dayOfWeek + 6) % 7;
  const buckets = new Map<number, string[]>();
  for (const [index, day] of days.entries()) {
    const weekNo = Math.floor((mondayOffset + index) / 7) + 1;
    const bucket = buckets.get(weekNo) ?? [];
    bucket.push(day.businessDate);
    buckets.set(weekNo, bucket);
  }
  return [...buckets.entries()].map(([weekNo, dates]) => ({
    weekNo,
    from: dates[0]!,
    to: dates.at(-1)!,
    dates,
  }));
}

export function businessWeekOfMonth(businessDate: string): number {
  if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(businessDate)) {
    throw new DomainError("VALIDATION_ERROR", "Ngày nghiệp vụ không hợp lệ.");
  }
  const month = businessDate.slice(0, 7);
  const week = enumerateBusinessWeeks(month).find((item) => item.dates.includes(businessDate));
  if (!week) {
    throw new DomainError("VALIDATION_ERROR", "Ngày nghiệp vụ không hợp lệ.");
  }
  return week.weekNo;
}

export type KpiEvaluationCriterionInput = Readonly<{
  code: string;
  weightBps: number;
  maxScore: number;
  score: string;
}>;

export type KpiEvaluationScore = Readonly<{
  totalScore: string;
  maximumScore: string;
  lines: readonly Readonly<{
    code: string;
    score: string;
    weightedScore: string;
  }>[];
}>;

export function calculateKpiEvaluationScore(
  criteria: readonly KpiEvaluationCriterionInput[],
): KpiEvaluationScore {
  if (criteria.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "KPI phải có ít nhất một tiêu chí.");
  }
  const seen = new Set<string>();
  let totalWeight = 0;
  let totalHundredths = 0n;
  let maximumHundredths = 0n;
  const lines = criteria.map((criterion) => {
    if (seen.has(criterion.code)) {
      throw new DomainError("VALIDATION_ERROR", `Mã KPI ${criterion.code} bị trùng.`);
    }
    seen.add(criterion.code);
    if (
      !Number.isInteger(criterion.weightBps) ||
      criterion.weightBps <= 0 ||
      criterion.weightBps > 10_000 ||
      !Number.isInteger(criterion.maxScore) ||
      criterion.maxScore <= 0
    ) {
      throw new DomainError("VALIDATION_ERROR", `Cấu hình KPI ${criterion.code} không hợp lệ.`);
    }
    const score = decimalHundredths(criterion.score);
    const maximum = BigInt(criterion.maxScore) * 100n;
    if (score > maximum) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Điểm KPI ${criterion.code} không được vượt ${criterion.maxScore}.`,
      );
    }
    totalWeight += criterion.weightBps;
    const weightedScore = roundRational(score * BigInt(criterion.weightBps), 10_000n);
    const weightedMaximum = roundRational(maximum * BigInt(criterion.weightBps), 10_000n);
    totalHundredths += weightedScore;
    maximumHundredths += weightedMaximum;
    return {
      code: criterion.code,
      score: hundredthsDecimal(score),
      weightedScore: hundredthsDecimal(weightedScore),
    };
  });
  if (totalWeight !== 10_000) {
    throw new DomainError("VALIDATION_ERROR", "Tổng trọng số KPI phải bằng 100%.");
  }
  return {
    totalScore: hundredthsDecimal(totalHundredths),
    maximumScore: hundredthsDecimal(maximumHundredths),
    lines,
  };
}

export type ComparablePenaltyItem = Readonly<{
  code: string;
  name: string;
  description: string;
  defaultAmount: string;
  isActive: boolean;
  displayColor: string;
  displayOrder: number;
}>;

export function comparePenaltyItems(
  fromItems: readonly ComparablePenaltyItem[],
  toItems: readonly ComparablePenaltyItem[],
): Readonly<{
  addedCodes: readonly string[];
  removedCodes: readonly string[];
  changedCodes: readonly string[];
}> {
  const fromByCode = new Map(fromItems.map((item) => [item.code, item]));
  const toByCode = new Map(toItems.map((item) => [item.code, item]));
  const addedCodes = [...toByCode.keys()].filter((code) => !fromByCode.has(code)).sort();
  const removedCodes = [...fromByCode.keys()].filter((code) => !toByCode.has(code)).sort();
  const changedCodes = [...toByCode.entries()]
    .filter(([code, item]) => {
      const previous = fromByCode.get(code);
      return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item);
    })
    .map(([code]) => code)
    .sort();

  return { addedCodes, removedCodes, changedCodes };
}

export type RevenueBand = Readonly<{
  code: string;
  minRevenue: string;
  maxRevenue: string | null;
  minInclusive: boolean;
  maxInclusive: boolean;
  priority: number;
}>;

type GapPolicy = "REQUIRE_CONTIGUOUS" | "ALLOW_GAPS";

function includedRevenueBounds(
  band: RevenueBand,
): Readonly<{ first: bigint; last: bigint | null }> {
  const minimum = BigInt(band.minRevenue);
  const maximum = band.maxRevenue === null ? null : BigInt(band.maxRevenue);
  const first = minimum + (band.minInclusive ? 0n : 1n);
  const last = maximum === null ? null : maximum - (band.maxInclusive ? 0n : 1n);
  if (last !== null && first > last) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Khoảng doanh số ${band.code} không chứa giá trị nguyên nào.`,
    );
  }
  return { first, last };
}

export function validateRevenueBands(bands: readonly RevenueBand[], gapPolicy: GapPolicy): void {
  if (bands.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Rule phải có ít nhất một bậc.");
  }
  const codes = new Set<string>();
  const priorities = new Set<number>();
  const ordered = bands
    .map((band) => {
      if (codes.has(band.code)) {
        throw new DomainError("VALIDATION_ERROR", `Mã bậc ${band.code} bị trùng.`);
      }
      if (priorities.has(band.priority)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Priority ${band.priority} bị trùng; mỗi bậc cần priority riêng.`,
        );
      }
      codes.add(band.code);
      priorities.add(band.priority);
      return { band, ...includedRevenueBounds(band) };
    })
    .sort((left, right) =>
      left.first === right.first
        ? left.band.priority - right.band.priority
        : left.first < right.first
          ? -1
          : 1,
    );

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.last === null || current.first <= previous.last) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Khoảng doanh số ${previous.band.code} và ${current.band.code} bị overlap.`,
      );
    }
    if (gapPolicy === "REQUIRE_CONTIGUOUS" && current.first !== previous.last + 1n) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Có khoảng trống giữa ${previous.band.code} và ${current.band.code}.`,
      );
    }
  }
}

export function matchRevenueBand<T extends RevenueBand>(
  revenueAmount: string,
  bands: readonly T[],
): T | null {
  const revenue = BigInt(revenueAmount);
  return (
    [...bands]
      .sort((left, right) => left.priority - right.priority)
      .find((band) => {
        const bounds = includedRevenueBounds(band);
        return revenue >= bounds.first && (bounds.last === null || revenue <= bounds.last);
      }) ?? null
  );
}

export type DailyRewardTier = RevenueBand &
  Readonly<{
    rewardAmount: string;
  }>;

export function calculateDailyReward(
  revenueAmount: string,
  tiers: readonly DailyRewardTier[],
): string {
  return matchRevenueBand(revenueAmount, tiers)?.rewardAmount ?? "0";
}

export type PenaltyOccurrencePolicy = Readonly<{
  penaltyStartsAt: number;
  countingWindow: "CALENDAR_MONTH" | "LIFETIME";
  countingKey: string;
}>;

export type PenaltyOccurrenceResult = Readonly<{
  occurrenceNo: number;
  computedAmount: string;
  isChargeable: boolean;
  remainingReminderCount: number;
}>;

export function calculatePenaltyOccurrence(
  policy: PenaltyOccurrencePolicy,
  occurrenceNo: number,
  defaultAmount: string,
): PenaltyOccurrenceResult {
  if (!Number.isInteger(occurrenceNo) || occurrenceNo <= 0) {
    throw new DomainError("VALIDATION_ERROR", "Số lần vi phạm phải là số nguyên dương.");
  }
  if (!Number.isInteger(policy.penaltyStartsAt) || policy.penaltyStartsAt <= 0) {
    throw new DomainError("VALIDATION_ERROR", "Mốc bắt đầu phạt phải là số nguyên dương.");
  }
  const amount = BigInt(defaultAmount);
  if (amount < 0n) {
    throw new DomainError("VALIDATION_ERROR", "Tiền phạt không được âm.");
  }
  const isChargeable = occurrenceNo >= policy.penaltyStartsAt;
  return {
    occurrenceNo,
    computedAmount: isChargeable ? amount.toString() : "0",
    isChargeable,
    remainingReminderCount: Math.max(policy.penaltyStartsAt - occurrenceNo, 0),
  };
}

export function penaltyCountingPeriod(
  businessDate: string,
  window: PenaltyOccurrencePolicy["countingWindow"],
): Readonly<{ start: string; end: string | null }> {
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== businessDate) {
    throw new DomainError("VALIDATION_ERROR", "Ngày vi phạm không hợp lệ.");
  }
  if (window === "LIFETIME") {
    return { start: "1970-01-01", end: null };
  }
  const start = `${businessDate.slice(0, 7)}-01`;
  const end = new Date(`${start}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end: end.toISOString().slice(0, 10) };
}

export type MonthlyLevelTier = Omit<RevenueBand, "priority"> &
  Readonly<{
    name: string;
    displayOrder: number;
    monthlyRevenueBonus: string;
    attendanceBonus: string;
    achievementBonus: string;
    retainLevelBonus: string;
    jumpLevelBonus: string;
    attendanceMinWorkUnits: string | null;
    achievementMinLiveMinutes: number | null;
    jumpMinLevelSteps: number;
  }>;

export type MonthlyLevelResult = Readonly<{
  suggestedLevel: MonthlyLevelTier | null;
  amount: string;
  attendanceEligible: boolean;
  achievementEligible: boolean;
  transition: "NONE" | "RETAIN" | "JUMP" | "DOWN";
}>;

export function calculateMonthlyLevelResult(
  input: Readonly<{
    monthlyCoins: string;
    workedDayCount: number;
    attendanceRequiredDays: number;
    previousLevelOrder: number | null;
    previousLevelCode: string | null;
  }>,
  levels: readonly MonthlyLevelTier[],
): MonthlyLevelResult {
  if (
    !Number.isInteger(input.workedDayCount) ||
    input.workedDayCount < 0 ||
    !Number.isInteger(input.attendanceRequiredDays) ||
    input.attendanceRequiredDays < 1 ||
    input.attendanceRequiredDays > 31
  ) {
    throw new DomainError("VALIDATION_ERROR", "Điều kiện số ngày chuyên cần không hợp lệ.");
  }
  assertUnsignedInteger(input.monthlyCoins, "Tổng xu tháng");
  const level = matchRevenueBand(
    input.monthlyCoins,
    levels.map((item) => ({ ...item, priority: item.displayOrder })),
  );
  if (!level) {
    return {
      suggestedLevel: null,
      amount: "0",
      attendanceEligible: false,
      achievementEligible: false,
      transition: "NONE",
    };
  }
  const attendanceEligible = input.workedDayCount >= input.attendanceRequiredDays;
  const achievementEligible = true;
  const transition =
    input.previousLevelCode === level.code
      ? "RETAIN"
      : input.previousLevelOrder !== null && level.displayOrder > input.previousLevelOrder
        ? "JUMP"
        : input.previousLevelOrder !== null && level.displayOrder < input.previousLevelOrder
          ? "DOWN"
          : "NONE";
  const amount =
    (attendanceEligible ? BigInt(level.attendanceBonus) : 0n) +
    (achievementEligible ? BigInt(level.achievementBonus) : 0n) +
    (transition === "RETAIN" ? BigInt(level.retainLevelBonus) : 0n) +
    (transition === "JUMP" ? BigInt(level.jumpLevelBonus) : 0n);
  return {
    suggestedLevel: level,
    amount: amount.toString(),
    attendanceEligible,
    achievementEligible,
    transition,
  };
}

type RoundingMode = "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEILING";

function roundRational(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "HALF_UP",
): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new DomainError("VALIDATION_ERROR", "Giá trị làm tròn không hợp lệ.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "FLOOR") return quotient;
  if (mode === "CEILING") return quotient + 1n;
  const doubled = remainder * 2n;
  if (doubled > denominator) return quotient + 1n;
  if (doubled < denominator) return quotient;
  return mode === "HALF_UP" || quotient % 2n !== 0n ? quotient + 1n : quotient;
}

function roundMoney(
  numerator: bigint,
  denominator: bigint,
  unit: number,
  mode: RoundingMode,
): bigint {
  const monetaryUnit = BigInt(unit);
  return roundRational(numerator, denominator * monetaryUnit, mode) * monetaryUnit;
}

export type SalaryRule = Readonly<{
  baseSalary: string;
  standardWorkdays: string;
  standardDaysOffPerMonth?: number;
  probationSalaryRateBps?: number;
  standardDailyMinutes: number;
  overtime: Readonly<{
    multiplierBps: number;
    eligibleAfterMinutes: number;
  }>;
  attendancePolicy: Readonly<{
    eligibleStatuses: readonly ("DRAFT" | "PRESENT" | "ABSENT" | "LEAVE")[];
    prorateMode: "WORK_UNITS" | "PRESENT_DAYS";
    minimumWorkUnitsForFullSalary: string | null;
    capAtStandardWorkdays: boolean;
  }>;
  roundingPolicy: Readonly<{
    unit: 1 | 10 | 100 | 1000;
    mode: RoundingMode;
    applyAt: "COMPONENT" | "TOTAL";
  }>;
}>;

export function daysInPayrollMonth(month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new DomainError("VALIDATION_ERROR", "Tháng tính lương không hợp lệ.");
  }
  const [yearValue, monthValue] = month.split("-");
  const year = Number(yearValue);
  const monthNumber = Number(monthValue);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    throw new DomainError("VALIDATION_ERROR", "Tháng tính lương không hợp lệ.");
  }
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function standardPayableDays(month: string, standardDaysOffPerMonth: number): number {
  if (
    !Number.isInteger(standardDaysOffPerMonth) ||
    standardDaysOffPerMonth < 0 ||
    standardDaysOffPerMonth > 30
  ) {
    throw new DomainError("VALIDATION_ERROR", "Số ngày nghỉ chuẩn phải từ 0 đến 30.");
  }
  const payableDays = daysInPayrollMonth(month) - standardDaysOffPerMonth;
  if (payableDays <= 0) {
    throw new DomainError("VALIDATION_ERROR", "Số ngày công chuẩn phải lớn hơn 0.");
  }
  return payableDays;
}

export type SalaryAttendanceValue = Readonly<{
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
  workUnits: string;
  overtimeMinutes: number;
}>;

export function calculateSalaryProjection(
  rule: SalaryRule,
  attendance: readonly SalaryAttendanceValue[],
): Readonly<{ baseSalaryAmount: string; overtimeAmount: string; totalAmount: string }> {
  const standardDays = decimalHundredths(rule.standardWorkdays);
  if (standardDays <= 0n) {
    throw new DomainError("VALIDATION_ERROR", "Số ngày công chuẩn phải lớn hơn 0.");
  }
  const workedAttendance = attendance.filter((row) => decimalHundredths(row.workUnits) > 0n);
  let worked =
    rule.attendancePolicy.prorateMode === "WORK_UNITS"
      ? workedAttendance.reduce((total, row) => total + decimalHundredths(row.workUnits), 0n)
      : BigInt(workedAttendance.length) * 100n;
  const fullThreshold = rule.attendancePolicy.minimumWorkUnitsForFullSalary;
  if (fullThreshold !== null && worked >= decimalHundredths(fullThreshold)) {
    worked = standardDays;
  }
  if (rule.attendancePolicy.capAtStandardWorkdays && worked > standardDays) {
    worked = standardDays;
  }

  const baseSalary = BigInt(rule.baseSalary);
  const overtimeMinutes = attendance.reduce(
    (total, row) => total + Math.max(0, row.overtimeMinutes - rule.overtime.eligibleAfterMinutes),
    0,
  );
  const baseNumerator = baseSalary * worked;
  const baseDenominator = standardDays;
  const overtimeNumerator =
    baseSalary * 100n * BigInt(overtimeMinutes) * BigInt(rule.overtime.multiplierBps);
  const overtimeDenominator = standardDays * BigInt(rule.standardDailyMinutes) * 10_000n;
  const { unit, mode, applyAt } = rule.roundingPolicy;

  if (applyAt === "COMPONENT") {
    const base = roundMoney(baseNumerator, baseDenominator, unit, mode);
    const overtime = roundMoney(overtimeNumerator, overtimeDenominator, unit, mode);
    return {
      baseSalaryAmount: base.toString(),
      overtimeAmount: overtime.toString(),
      totalAmount: (base + overtime).toString(),
    };
  }
  const commonDenominator = baseDenominator * overtimeDenominator;
  const totalNumerator = baseNumerator * overtimeDenominator + overtimeNumerator * baseDenominator;
  const total = roundMoney(totalNumerator, commonDenominator, unit, mode);
  return {
    baseSalaryAmount: roundRational(baseNumerator, baseDenominator).toString(),
    overtimeAmount: roundRational(overtimeNumerator, overtimeDenominator).toString(),
    totalAmount: total.toString(),
  };
}

export function calculateKpiMaximumScore(
  criteria: readonly Readonly<{ weightBps: number; maxScore: number }>[],
): string {
  const hundredths = criteria.reduce(
    (total, criterion) =>
      total + roundRational(BigInt(criterion.weightBps * criterion.maxScore * 100), 10_000n),
    0n,
  );
  return hundredthsDecimal(hundredths);
}

export function compareConfigurationPaths(
  from: unknown,
  to: unknown,
  path = "$",
): readonly string[] {
  if (Object.is(from, to)) return [];
  if (
    typeof from !== "object" ||
    from === null ||
    typeof to !== "object" ||
    to === null ||
    Array.isArray(from) !== Array.isArray(to)
  ) {
    return [path];
  }
  const fromRecord = from as Readonly<Record<string, unknown>>;
  const toRecord = to as Readonly<Record<string, unknown>>;
  const keys = [...new Set([...Object.keys(fromRecord), ...Object.keys(toRecord)])].sort();
  return keys.flatMap((key) =>
    compareConfigurationPaths(fromRecord[key], toRecord[key], `${path}.${key}`),
  );
}

export const PAYROLL_LINE_TYPES = [
  "BASE_SALARY",
  "PRORATED_SALARY",
  "DAILY_REVENUE_BONUS",
  "MONTHLY_REVENUE_BONUS",
  "ATTENDANCE_BONUS",
  "ACHIEVEMENT_BONUS",
  "LEVEL_BONUS",
  "OVERTIME_PAY",
  "OTHER_BONUS",
  "PENALTY",
  "ADVANCE",
  "TOTAL_INCOME",
] as const;

export type PayrollLineType = (typeof PAYROLL_LINE_TYPES)[number];

export type PayrollAttendanceInput = Readonly<{
  attendanceId: string;
  businessDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
  workUnits: string;
  overtimeMinutes: number;
  actualLiveMinutes: number;
  revenueAmount: string;
  rewardThresholdAmount?: string | null;
  dailyRevenueBonusOverride?: string;
  penaltiesOverride?: string;
  violationCategory?: string | null;
  violationDetail?: string | null;
  note?: string | null;
  overriddenFields?: readonly string[];
  source?: Readonly<{
    checkInTime: string | null;
    checkOutTime: string | null;
    status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
    workUnits: string;
    overtimeMinutes: number;
    actualLiveMinutes: number;
    revenueAmount: string;
    rewardThresholdAmount: string | null;
    dailyRevenueBonus: string;
    violationCategory: string | null;
    violationDetail: string | null;
    penalties: string;
    note: string | null;
  }>;
  dailyRewardRule: Readonly<{
    ruleVersionId: string;
    tiers: readonly DailyRewardTier[];
  }> | null;
  violations: readonly Readonly<{
    violationId: string;
    ruleVersionId: string;
    amount: string;
    itemName: string;
  }>[];
}>;

export function countWorkedDays(attendance: readonly PayrollAttendanceInput[]): number {
  return new Set(
    attendance
      .filter((row) => decimalHundredths(row.workUnits) > 0n)
      .map((row) => row.businessDate),
  ).size;
}

export type PayrollAdjustmentInput = Readonly<{
  adjustmentId: string;
  type: "OTHER_BONUS" | "ADVANCE" | "CORRECTION";
  amount: string;
  reason: string;
}>;

export type PayrollMachineCodeInterval = Readonly<{
  assignmentId: string;
  attendanceMachineCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}>;

export type PayrollLine = Readonly<{
  type: PayrollLineType;
  amount: string;
  sourceType: string;
  sourceId: string;
  ruleVersionId: string | null;
  label: string;
  calculationDetails: Readonly<Record<string, string | number | boolean | null>>;
  includedInTotal: boolean;
}>;

export type PayrollCalculationInput = Readonly<{
  staffId: string;
  staffIdentity?: Readonly<{
    staffCode: string;
    fullName: string;
    streamingAlias: string | null;
    attendanceMachineCodeIntervals: readonly PayrollMachineCodeInterval[];
  }>;
  baseSalaryAmount: string;
  sourceBaseSalaryAmount?: string;
  employment?: Readonly<{
    joinedDate: string | null;
    officialDate: string | null;
    category: "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN";
  }>;
  period: Readonly<{
    branchId?: string;
    month: string;
    from: string;
    toExclusive: string;
    timezone: "Asia/Ho_Chi_Minh";
  }>;
  attendance: readonly PayrollAttendanceInput[];
  salaryRule: Readonly<{
    ruleVersionId: string;
    configuration: SalaryRule;
    sourceStandardDaysOffPerMonth?: number | null;
  }>;
  monthlyLevelRule: Readonly<{
    ruleVersionId: string;
    attendanceRequiredDays: number;
    levels: readonly MonthlyLevelTier[];
  }> | null;
  previousMonth: Readonly<{
    coins: string | null;
    source: "PUBLISHED_PAYROLL" | "ATTENDANCE_LIVE" | "MANUAL_BASELINE" | "NONE";
    level: Readonly<{
      code: string;
      name: string;
      displayOrder: number;
    }> | null;
  }>;
  currentLevel: Readonly<{
    code: string;
    displayOrder: number;
  }> | null;
  levelDisplay?: Readonly<{
    previousLevelCode: string | null;
    sourceCurrentLevelCode?: string | null;
    sourceCurrentLevelName?: string | null;
    currentLevelCode: string | null;
    currentLevelName: string | null;
  }>;
  componentOverrides?: Readonly<{
    proratedSalary?: string;
    dailyRevenueBonus?: string;
    monthlyRevenueBonus?: string;
    attendanceBonus?: string;
    achievementBonus?: string;
    retainLevelBonus?: string;
    jumpLevelBonus?: string;
    overtimePay?: string;
    otherBonus?: string;
    penalties?: string;
    advance?: string;
  }>;
  adjustments: readonly PayrollAdjustmentInput[];
}>;

export type PayrollCalculationOutput = Readonly<{
  aggregates: Readonly<{
    workUnits: string;
    workedDayCount: number;
    overtimeMinutes: number;
    revenueAmount: string;
    currentMonthCoins: string;
    actualLiveMinutes: number;
    penalties: string;
    violationCount: number;
  }>;
  components: Readonly<{
    baseSalary: string;
    proratedSalary: string;
    dailyRevenueBonus: string;
    monthlyRevenueBonus: string;
    attendanceBonus: string;
    achievementBonus: string;
    retainLevelBonus: string;
    jumpLevelBonus: string;
    levelBonus: string;
    overtimePay: string;
    otherBonus: string;
    penalties: string;
    advance: string;
    totalIncome: string;
  }>;
  calculatedComponents: Readonly<{
    proratedSalary: string;
    dailyRevenueBonus: string;
    monthlyRevenueBonus: string;
    attendanceBonus: string;
    achievementBonus: string;
    retainLevelBonus: string;
    jumpLevelBonus: string;
    overtimePay: string;
    otherBonus: string;
    penalties: string;
    advance: string;
    totalIncome: string;
  }>;
  salaryBasis: Readonly<{
    daysInMonth: number;
    standardDaysOffPerMonth: number | null;
    standardPayableDays: number;
  }>;
  employmentSalary: Readonly<{
    joinedDate: string | null;
    officialDate: string | null;
    probationSalaryRateBps: number;
    probationWorkUnits: string;
    officialWorkUnits: string;
    excludedBeforeJoinWorkUnits: string;
    probationSalaryAmount: string;
    officialSalaryAmount: string;
    calculatedProratedSalary: string;
    fallbackMode:
      | "OFFICIAL_DATE"
      | "PROBATION_WITHOUT_OFFICIAL_DATE"
      | "LEGACY_OFFICIAL_WITHOUT_OFFICIAL_DATE"
      | "NON_PROBATION_CATEGORY";
  }>;
  monthlyLevel: Readonly<{
    workedDayCount: number;
    attendanceRequiredDays: number | null;
    attendanceEligible: boolean;
    previousMonthCoins: string | null;
    previousMonthCoinsSource: "PUBLISHED_PAYROLL" | "ATTENDANCE_LIVE" | "MANUAL_BASELINE" | "NONE";
    previousLevelCode: string | null;
    previousLevelName: string | null;
    previousLevelOrder: number | null;
    currentMonthCoins: string;
    currentLevelCode: string | null;
    currentLevelName: string | null;
    currentLevelOrder: number | null;
    transition: "NONE" | "RETAIN" | "JUMP" | "DOWN";
  }>;
  suggestedLevelCode: string | null;
  selectedRuleVersionIds: readonly string[];
  anomalyFlags: readonly string[];
  lines: readonly PayrollLine[];
}>;

function assertUnsignedInteger(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new DomainError("VALIDATION_ERROR", `${label} phải là số nguyên không âm.`);
  }
  return BigInt(value);
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type EmploymentSalaryProjection = Readonly<{
  baseSalaryAmount: string;
  overtimeAmount: string;
  totalAmount: string;
  joinedDate: string | null;
  officialDate: string | null;
  probationSalaryRateBps: number;
  probationWorkUnits: string;
  officialWorkUnits: string;
  excludedBeforeJoinWorkUnits: string;
  probationWeight: bigint;
  officialWeight: bigint;
  fallbackMode: PayrollCalculationOutput["employmentSalary"]["fallbackMode"];
}>;

function calculateEmploymentSalaryProjection(
  rule: SalaryRule,
  attendance: readonly PayrollAttendanceInput[],
  employment: PayrollCalculationInput["employment"],
): EmploymentSalaryProjection {
  const standardDays = decimalHundredths(rule.standardWorkdays);
  if (standardDays <= 0n) {
    throw new DomainError("VALIDATION_ERROR", "Số ngày công chuẩn phải lớn hơn 0.");
  }
  const probationSalaryRateBps = rule.probationSalaryRateBps ?? 8_500;
  if (
    !Number.isInteger(probationSalaryRateBps) ||
    probationSalaryRateBps < 0 ||
    probationSalaryRateBps > 10_000
  ) {
    throw new DomainError("VALIDATION_ERROR", "Tỷ lệ lương thử việc phải từ 0% đến 100%.");
  }

  const employmentInput = employment ?? {
    joinedDate: null,
    officialDate: null,
    category: "OFFICIAL" as const,
  };
  const { joinedDate, officialDate, category } = employmentInput;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (
    (joinedDate !== null && !datePattern.test(joinedDate)) ||
    (officialDate !== null && !datePattern.test(officialDate)) ||
    (joinedDate !== null && officialDate !== null && officialDate < joinedDate)
  ) {
    throw new DomainError("VALIDATION_ERROR", "Ngày gia nhập hoặc ngày chính thức không hợp lệ.");
  }

  const fallbackMode: EmploymentSalaryProjection["fallbackMode"] = officialDate
    ? "OFFICIAL_DATE"
    : category === "PROBATION"
      ? "PROBATION_WITHOUT_OFFICIAL_DATE"
      : category === "OFFICIAL"
        ? "LEGACY_OFFICIAL_WITHOUT_OFFICIAL_DATE"
        : "NON_PROBATION_CATEGORY";
  const workedAttendance = attendance.filter((row) => decimalHundredths(row.workUnits) > 0n);
  let probationWorkUnits = 0n;
  let officialWorkUnits = 0n;
  let excludedBeforeJoinWorkUnits = 0n;
  for (const row of workedAttendance) {
    const workUnits =
      rule.attendancePolicy.prorateMode === "WORK_UNITS" ? decimalHundredths(row.workUnits) : 100n;
    if (joinedDate && row.businessDate < joinedDate) {
      excludedBeforeJoinWorkUnits += workUnits;
    } else if (
      (officialDate && row.businessDate < officialDate) ||
      (!officialDate && category === "PROBATION")
    ) {
      probationWorkUnits += workUnits;
    } else {
      officialWorkUnits += workUnits;
    }
  }

  const fullThreshold = rule.attendancePolicy.minimumWorkUnitsForFullSalary;
  const includedWorkUnits = probationWorkUnits + officialWorkUnits;
  if (
    fullThreshold !== null &&
    includedWorkUnits >= decimalHundredths(fullThreshold) &&
    includedWorkUnits < standardDays
  ) {
    const additionalWorkUnits = standardDays - includedWorkUnits;
    if (officialWorkUnits > 0n || fallbackMode !== "PROBATION_WITHOUT_OFFICIAL_DATE") {
      officialWorkUnits += additionalWorkUnits;
    } else {
      probationWorkUnits += additionalWorkUnits;
    }
  }
  if (
    rule.attendancePolicy.capAtStandardWorkdays &&
    probationWorkUnits + officialWorkUnits > standardDays
  ) {
    probationWorkUnits = probationWorkUnits > standardDays ? standardDays : probationWorkUnits;
    officialWorkUnits =
      officialWorkUnits > standardDays - probationWorkUnits
        ? standardDays - probationWorkUnits
        : officialWorkUnits;
  }

  const baseSalary = BigInt(rule.baseSalary);
  const probationWeight = probationWorkUnits * BigInt(probationSalaryRateBps);
  const officialWeight = officialWorkUnits * 10_000n;
  const baseNumerator = baseSalary * (probationWeight + officialWeight);
  const baseDenominator = standardDays * 10_000n;
  const overtimeMinutes = attendance.reduce(
    (total, row) => total + Math.max(0, row.overtimeMinutes - rule.overtime.eligibleAfterMinutes),
    0,
  );
  const overtimeNumerator =
    baseSalary * 100n * BigInt(overtimeMinutes) * BigInt(rule.overtime.multiplierBps);
  const overtimeDenominator = standardDays * BigInt(rule.standardDailyMinutes) * 10_000n;
  const { unit, mode, applyAt } = rule.roundingPolicy;

  let baseSalaryAmount: bigint;
  let overtimeAmount: bigint;
  let totalAmount: bigint;
  if (applyAt === "COMPONENT") {
    baseSalaryAmount = roundMoney(baseNumerator, baseDenominator, unit, mode);
    overtimeAmount = roundMoney(overtimeNumerator, overtimeDenominator, unit, mode);
    totalAmount = baseSalaryAmount + overtimeAmount;
  } else {
    const commonDenominator = baseDenominator * overtimeDenominator;
    const totalNumerator =
      baseNumerator * overtimeDenominator + overtimeNumerator * baseDenominator;
    baseSalaryAmount = roundRational(baseNumerator, baseDenominator);
    overtimeAmount = roundRational(overtimeNumerator, overtimeDenominator);
    totalAmount = roundMoney(totalNumerator, commonDenominator, unit, mode);
  }

  return {
    baseSalaryAmount: baseSalaryAmount.toString(),
    overtimeAmount: overtimeAmount.toString(),
    totalAmount: totalAmount.toString(),
    joinedDate,
    officialDate,
    probationSalaryRateBps,
    probationWorkUnits: hundredthsDecimal(probationWorkUnits),
    officialWorkUnits: hundredthsDecimal(officialWorkUnits),
    excludedBeforeJoinWorkUnits: hundredthsDecimal(excludedBeforeJoinWorkUnits),
    probationWeight,
    officialWeight,
    fallbackMode,
  };
}

/**
 * Pure payroll calculator. The caller resolves effective-dated rules and snapshots
 * the returned input/output; this function never reads a clock, database or environment.
 */
export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationOutput {
  if (
    !/^\d{4}-\d{2}$/.test(input.period.month) ||
    input.period.from >= input.period.toExclusive ||
    input.period.timezone !== "Asia/Ho_Chi_Minh"
  ) {
    throw new DomainError("VALIDATION_ERROR", "Kỳ lương không hợp lệ.");
  }
  const baseSalaryAmount = assertUnsignedInteger(input.baseSalaryAmount, "Lương cơ bản");
  const configuredDaysOff = input.salaryRule.configuration.standardDaysOffPerMonth ?? null;
  const payableDays =
    configuredDaysOff === null
      ? Number(input.salaryRule.configuration.standardWorkdays)
      : standardPayableDays(input.period.month, configuredDaysOff);
  if (!Number.isFinite(payableDays) || payableDays <= 0) {
    throw new DomainError("VALIDATION_ERROR", "Số ngày công chuẩn phải lớn hơn 0.");
  }
  const effectiveSalaryRule: SalaryRule = {
    ...input.salaryRule.configuration,
    baseSalary: baseSalaryAmount.toString(),
    standardWorkdays: payableDays.toString(),
  };

  const attendance = [...input.attendance].sort((left, right) =>
    compareStableText(left.attendanceId, right.attendanceId),
  );
  const seenAttendance = new Set<string>();
  const seenViolations = new Set<string>();
  const seenAdjustments = new Set<string>();
  for (const row of attendance) {
    if (seenAttendance.has(row.attendanceId)) {
      throw new DomainError("VALIDATION_ERROR", `Attendance ${row.attendanceId} bị trùng.`);
    }
    seenAttendance.add(row.attendanceId);
    if (row.businessDate < input.period.from || row.businessDate >= input.period.toExclusive) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Attendance ${row.attendanceId} nằm ngoài kỳ lương.`,
      );
    }
    assertUnsignedInteger(row.revenueAmount, "Số xu");
    if (row.dailyRevenueBonusOverride !== undefined) {
      assertUnsignedInteger(row.dailyRevenueBonusOverride, "Thưởng ngày điều chỉnh");
    }
    if (row.penaltiesOverride !== undefined) {
      assertUnsignedInteger(row.penaltiesOverride, "Tiền phạt điều chỉnh");
    }
    for (const violation of row.violations) {
      if (seenViolations.has(violation.violationId)) {
        throw new DomainError("VALIDATION_ERROR", `Violation ${violation.violationId} bị trùng.`);
      }
      seenViolations.add(violation.violationId);
      assertUnsignedInteger(violation.amount, "Tiền phạt");
    }
  }
  for (const [key, value] of Object.entries(input.componentOverrides ?? {})) {
    if (value === undefined) continue;
    if (key === "otherBonus") {
      if (!/^-?\d+$/.test(value)) {
        throw new DomainError("VALIDATION_ERROR", "Thưởng khác điều chỉnh phải là số nguyên VND.");
      }
    } else {
      assertUnsignedInteger(value, `${key} điều chỉnh`);
    }
  }
  for (const adjustment of input.adjustments) {
    if (seenAdjustments.has(adjustment.adjustmentId)) {
      throw new DomainError("VALIDATION_ERROR", `Adjustment ${adjustment.adjustmentId} bị trùng.`);
    }
    seenAdjustments.add(adjustment.adjustmentId);
    if (
      adjustment.type !== "CORRECTION" &&
      (!/^\d+$/.test(adjustment.amount) || BigInt(adjustment.amount) < 0n)
    ) {
      throw new DomainError("VALIDATION_ERROR", `${adjustment.type} phải là số nguyên không âm.`);
    }
    if (!/^-?\d+$/.test(adjustment.amount)) {
      throw new DomainError("VALIDATION_ERROR", "Correction phải là số nguyên VND.");
    }
  }

  const aggregate = summarizeMonthlyMetrics(
    attendance.map((row) => ({
      revenueAmount: row.revenueAmount,
      workUnits: row.workUnits,
      actualLiveMinutes: row.actualLiveMinutes,
      overtimeMinutes: row.overtimeMinutes,
      penaltyAmount:
        row.penaltiesOverride ??
        row.violations
          .reduce((total, violation) => total + BigInt(violation.amount), 0n)
          .toString(),
    })),
  );
  const workedDayCount = countWorkedDays(attendance);
  const salary = calculateEmploymentSalaryProjection(
    effectiveSalaryRule,
    attendance,
    input.employment,
  );
  const salaryTotal = BigInt(salary.totalAmount);
  const rawProratedSalary = BigInt(salary.baseSalaryAmount);
  const rawOvertimePay = BigInt(salary.overtimeAmount);
  const rawSalaryTotal = rawProratedSalary + rawOvertimePay;
  const calculatedProratedSalary =
    input.salaryRule.configuration.roundingPolicy.applyAt === "TOTAL"
      ? rawSalaryTotal === 0n
        ? 0n
        : roundRational(salaryTotal * rawProratedSalary, rawSalaryTotal)
      : rawProratedSalary;
  const calculatedOvertimePay =
    input.salaryRule.configuration.roundingPolicy.applyAt === "TOTAL"
      ? salaryTotal - calculatedProratedSalary
      : rawOvertimePay;
  const totalSalaryWeight = salary.probationWeight + salary.officialWeight;
  const calculatedProbationSalary =
    totalSalaryWeight === 0n
      ? 0n
      : roundRational(calculatedProratedSalary * salary.probationWeight, totalSalaryWeight);
  const calculatedOfficialSalary = calculatedProratedSalary - calculatedProbationSalary;
  const proratedSalary = BigInt(
    input.componentOverrides?.proratedSalary ?? calculatedProratedSalary.toString(),
  );
  const overtimePay = BigInt(
    input.componentOverrides?.overtimePay ?? calculatedOvertimePay.toString(),
  );

  const lines: PayrollLine[] = [];
  const pushLine = (line: PayrollLine): void => {
    lines.push(line);
  };
  pushLine({
    type: "BASE_SALARY",
    amount: input.baseSalaryAmount,
    sourceType: "STAFF_MEMBER",
    sourceId: input.staffId,
    ruleVersionId: input.salaryRule.ruleVersionId,
    label: "Lương cơ bản nhân viên",
    calculationDetails: {
      standardWorkdays: effectiveSalaryRule.standardWorkdays,
      standardDaysOffPerMonth: configuredDaysOff,
      includedInTotal: false,
    },
    includedInTotal: false,
  });
  pushLine({
    type: "PRORATED_SALARY",
    amount: proratedSalary.toString(),
    sourceType: "RULE_VERSION",
    sourceId: input.salaryRule.ruleVersionId,
    ruleVersionId: input.salaryRule.ruleVersionId,
    label: "Lương theo công",
    calculationDetails: {
      workUnits: aggregate.workUnits,
      standardWorkdays: effectiveSalaryRule.standardWorkdays,
      prorateMode: input.salaryRule.configuration.attendancePolicy.prorateMode,
      joinedDate: salary.joinedDate,
      officialDate: salary.officialDate,
      probationSalaryRateBps: salary.probationSalaryRateBps,
      probationWorkUnits: salary.probationWorkUnits,
      officialWorkUnits: salary.officialWorkUnits,
      excludedBeforeJoinWorkUnits: salary.excludedBeforeJoinWorkUnits,
      probationSalaryAmount: calculatedProbationSalary.toString(),
      officialSalaryAmount: calculatedOfficialSalary.toString(),
      fallbackMode: salary.fallbackMode,
      overridden: input.componentOverrides?.proratedSalary !== undefined,
    },
    includedInTotal: true,
  });
  pushLine({
    type: "OVERTIME_PAY",
    amount: overtimePay.toString(),
    sourceType: "RULE_VERSION",
    sourceId: input.salaryRule.ruleVersionId,
    ruleVersionId: input.salaryRule.ruleVersionId,
    label: "Tiền tăng ca",
    calculationDetails: {
      overtimeMinutes: aggregate.overtimeMinutes,
      multiplierBps: input.salaryRule.configuration.overtime.multiplierBps,
      roundingApplyAt: input.salaryRule.configuration.roundingPolicy.applyAt,
      overridden: input.componentOverrides?.overtimePay !== undefined,
    },
    includedInTotal: true,
  });

  let calculatedDailyRevenueBonus = 0n;
  let dailyRevenueBonus = 0n;
  for (const row of attendance) {
    const calculatedAmount = row.dailyRewardRule
      ? BigInt(calculateDailyReward(row.revenueAmount, row.dailyRewardRule.tiers))
      : 0n;
    calculatedDailyRevenueBonus += calculatedAmount;
    const amount = BigInt(row.dailyRevenueBonusOverride ?? calculatedAmount.toString());
    if (amount === 0n) continue;
    dailyRevenueBonus += amount;
    pushLine({
      type: "DAILY_REVENUE_BONUS",
      amount: amount.toString(),
      sourceType: "ATTENDANCE_DAY",
      sourceId: row.attendanceId,
      ruleVersionId: row.dailyRewardRule?.ruleVersionId ?? null,
      label: `Thưởng xu ngày ${row.businessDate}`,
      calculationDetails: {
        businessDate: row.businessDate,
        dailyCoins: row.revenueAmount,
        overridden: row.dailyRevenueBonusOverride !== undefined,
      },
      includedInTotal: input.componentOverrides?.dailyRevenueBonus === undefined,
    });
  }
  if (input.componentOverrides?.dailyRevenueBonus !== undefined) {
    dailyRevenueBonus = BigInt(input.componentOverrides.dailyRevenueBonus);
    pushLine({
      type: "DAILY_REVENUE_BONUS",
      amount: dailyRevenueBonus.toString(),
      sourceType: "PAYROLL_WORKSHEET_OVERRIDE",
      sourceId: `${input.staffId}:${input.period.month}:daily-bonus`,
      ruleVersionId: null,
      label: "Tổng thưởng xu ngày đã chỉnh",
      calculationDetails: { overridden: true },
      includedInTotal: true,
    });
  }

  let monthlyRevenueBonus = 0n;
  let attendanceBonus = 0n;
  let achievementBonus = 0n;
  let retainLevelBonus = 0n;
  let jumpLevelBonus = 0n;
  let suggestedLevelCode: string | null = null;
  let suggestedLevelName: string | null = null;
  let monthlyTransition: "NONE" | "RETAIN" | "JUMP" | "DOWN" = "NONE";
  let attendanceEligible = false;
  if (input.monthlyLevelRule) {
    const result = calculateMonthlyLevelResult(
      {
        monthlyCoins: aggregate.revenueAmount,
        workedDayCount,
        attendanceRequiredDays: input.monthlyLevelRule.attendanceRequiredDays,
        previousLevelCode: input.previousMonth.level?.code ?? null,
        previousLevelOrder: input.previousMonth.level?.displayOrder ?? null,
      },
      input.monthlyLevelRule.levels,
    );
    const level = result.suggestedLevel;
    monthlyTransition = result.transition;
    attendanceEligible = result.attendanceEligible;
    if (level) {
      suggestedLevelCode = level.code;
      suggestedLevelName = level.name;
      attendanceBonus = result.attendanceEligible ? BigInt(level.attendanceBonus) : 0n;
      achievementBonus = BigInt(level.achievementBonus);
      retainLevelBonus = result.transition === "RETAIN" ? BigInt(level.retainLevelBonus) : 0n;
      jumpLevelBonus = result.transition === "JUMP" ? BigInt(level.jumpLevelBonus) : 0n;
    }
  }

  const calculatedMonthlyRevenueBonus = monthlyRevenueBonus;
  const calculatedAttendanceBonus = attendanceBonus;
  const calculatedAchievementBonus = achievementBonus;
  const calculatedRetainLevelBonus = retainLevelBonus;
  const calculatedJumpLevelBonus = jumpLevelBonus;
  monthlyRevenueBonus = BigInt(
    input.componentOverrides?.monthlyRevenueBonus ?? monthlyRevenueBonus.toString(),
  );
  attendanceBonus = BigInt(input.componentOverrides?.attendanceBonus ?? attendanceBonus.toString());
  achievementBonus = BigInt(
    input.componentOverrides?.achievementBonus ?? achievementBonus.toString(),
  );
  retainLevelBonus = BigInt(
    input.componentOverrides?.retainLevelBonus ?? retainLevelBonus.toString(),
  );
  jumpLevelBonus = BigInt(input.componentOverrides?.jumpLevelBonus ?? jumpLevelBonus.toString());
  const levelBonus = retainLevelBonus + jumpLevelBonus;
  const monthlyComponents = [
    [
      "MONTHLY_REVENUE_BONUS",
      monthlyRevenueBonus,
      "Thưởng xu tháng (cũ)",
      input.componentOverrides?.monthlyRevenueBonus !== undefined,
    ],
    [
      "ATTENDANCE_BONUS",
      attendanceBonus,
      "Thưởng chuyên cần",
      input.componentOverrides?.attendanceBonus !== undefined,
    ],
    [
      "ACHIEVEMENT_BONUS",
      achievementBonus,
      "Thưởng thành tích",
      input.componentOverrides?.achievementBonus !== undefined,
    ],
    [
      "LEVEL_BONUS",
      retainLevelBonus,
      "Thưởng giữ bậc",
      input.componentOverrides?.retainLevelBonus !== undefined,
    ],
    [
      "LEVEL_BONUS",
      jumpLevelBonus,
      "Thưởng nhảy bậc",
      input.componentOverrides?.jumpLevelBonus !== undefined,
    ],
  ] as const;
  for (const [type, amount, label, overridden] of monthlyComponents) {
    if (amount === 0n && !overridden) continue;
    pushLine({
      type,
      amount: amount.toString(),
      sourceType: overridden ? "PAYROLL_WORKSHEET_OVERRIDE" : "MONTHLY_LEVEL",
      sourceId: `${input.staffId}:${input.period.month}`,
      ruleVersionId: overridden ? null : (input.monthlyLevelRule?.ruleVersionId ?? null),
      label,
      calculationDetails: {
        levelCode: suggestedLevelCode,
        monthlyCoins: aggregate.revenueAmount,
        workedDayCount,
        attendanceRequiredDays: input.monthlyLevelRule?.attendanceRequiredDays ?? null,
        transition: monthlyTransition,
        overridden,
      },
      includedInTotal: true,
    });
  }

  let calculatedPenalties = 0n;
  let penalties = 0n;
  for (const row of attendance) {
    const rowCalculated = row.violations.reduce(
      (total, violation) => total + BigInt(violation.amount),
      0n,
    );
    calculatedPenalties += rowCalculated;
    if (row.penaltiesOverride !== undefined) {
      const amount = BigInt(row.penaltiesOverride);
      penalties += amount;
      pushLine({
        type: "PENALTY",
        amount: amount.toString(),
        sourceType: "PAYROLL_WORKSHEET_OVERRIDE",
        sourceId: `${input.staffId}:${row.businessDate}:penalty`,
        ruleVersionId: null,
        label: `Phạt ngày ${row.businessDate} đã chỉnh`,
        calculationDetails: { businessDate: row.businessDate, overridden: true },
        includedInTotal: input.componentOverrides?.penalties === undefined,
      });
      continue;
    }
    for (const violation of [...row.violations].sort((left, right) =>
      compareStableText(left.violationId, right.violationId),
    )) {
      const amount = BigInt(violation.amount);
      penalties += amount;
      pushLine({
        type: "PENALTY",
        amount: amount.toString(),
        sourceType: "VIOLATION",
        sourceId: violation.violationId,
        ruleVersionId: violation.ruleVersionId,
        label: violation.itemName,
        calculationDetails: { businessDate: row.businessDate },
        includedInTotal: input.componentOverrides?.penalties === undefined,
      });
    }
  }
  if (input.componentOverrides?.penalties !== undefined) {
    penalties = BigInt(input.componentOverrides.penalties);
    pushLine({
      type: "PENALTY",
      amount: penalties.toString(),
      sourceType: "PAYROLL_WORKSHEET_OVERRIDE",
      sourceId: `${input.staffId}:${input.period.month}:penalty`,
      ruleVersionId: null,
      label: "Tổng tiền phạt đã chỉnh",
      calculationDetails: { overridden: true },
      includedInTotal: true,
    });
  }

  let otherBonus = 0n;
  let advance = 0n;
  for (const adjustment of [...input.adjustments].sort((left, right) =>
    compareStableText(left.adjustmentId, right.adjustmentId),
  )) {
    const amount = BigInt(adjustment.amount);
    if (adjustment.type === "ADVANCE") {
      advance += amount;
      pushLine({
        type: "ADVANCE",
        amount: amount.toString(),
        sourceType: "PAYROLL_ADJUSTMENT",
        sourceId: adjustment.adjustmentId,
        ruleVersionId: null,
        label: "Tạm ứng",
        calculationDetails: { reason: adjustment.reason },
        includedInTotal: input.componentOverrides?.advance === undefined,
      });
    } else {
      otherBonus += amount;
      pushLine({
        type: "OTHER_BONUS",
        amount: amount.toString(),
        sourceType: "PAYROLL_ADJUSTMENT",
        sourceId: adjustment.adjustmentId,
        ruleVersionId: null,
        label: adjustment.type === "CORRECTION" ? "Điều chỉnh" : "Thưởng khác",
        calculationDetails: { reason: adjustment.reason },
        includedInTotal: input.componentOverrides?.otherBonus === undefined,
      });
    }
  }
  const calculatedOtherBonus = otherBonus;
  const calculatedAdvance = advance;
  otherBonus = BigInt(input.componentOverrides?.otherBonus ?? otherBonus.toString());
  advance = BigInt(input.componentOverrides?.advance ?? advance.toString());
  if (input.componentOverrides?.otherBonus !== undefined) {
    pushLine({
      type: "OTHER_BONUS",
      amount: otherBonus.toString(),
      sourceType: "PAYROLL_WORKSHEET_OVERRIDE",
      sourceId: `${input.staffId}:${input.period.month}:other-bonus`,
      ruleVersionId: null,
      label: "Thưởng khác đã chỉnh",
      calculationDetails: { overridden: true },
      includedInTotal: true,
    });
  }
  if (input.componentOverrides?.advance !== undefined) {
    pushLine({
      type: "ADVANCE",
      amount: advance.toString(),
      sourceType: "PAYROLL_WORKSHEET_OVERRIDE",
      sourceId: `${input.staffId}:${input.period.month}:advance`,
      ruleVersionId: null,
      label: "Tạm ứng đã chỉnh",
      calculationDetails: { overridden: true },
      includedInTotal: true,
    });
  }

  const totalIncome =
    proratedSalary +
    overtimePay +
    dailyRevenueBonus +
    monthlyRevenueBonus +
    attendanceBonus +
    achievementBonus +
    levelBonus +
    otherBonus -
    penalties -
    advance;
  const calculatedTotalIncome =
    calculatedProratedSalary +
    calculatedOvertimePay +
    calculatedDailyRevenueBonus +
    calculatedMonthlyRevenueBonus +
    calculatedAttendanceBonus +
    calculatedAchievementBonus +
    calculatedRetainLevelBonus +
    calculatedJumpLevelBonus +
    calculatedOtherBonus -
    calculatedPenalties -
    calculatedAdvance;
  pushLine({
    type: "TOTAL_INCOME",
    amount: totalIncome.toString(),
    sourceType: "PAYROLL_PERIOD",
    sourceId: `${input.staffId}:${input.period.month}`,
    ruleVersionId: null,
    label: "Thực nhận",
    calculationDetails: { reconciled: true },
    includedInTotal: false,
  });

  const selectedRuleVersionIds = [
    input.salaryRule.ruleVersionId,
    ...(input.monthlyLevelRule ? [input.monthlyLevelRule.ruleVersionId] : []),
    ...attendance.flatMap((row) =>
      row.dailyRewardRule ? [row.dailyRewardRule.ruleVersionId] : [],
    ),
    ...attendance.flatMap((row) => row.violations.map((item) => item.ruleVersionId)),
  ].filter((value, index, values) => values.indexOf(value) === index);

  return {
    aggregates: {
      workUnits: aggregate.workUnits,
      workedDayCount,
      overtimeMinutes: aggregate.overtimeMinutes,
      revenueAmount: aggregate.revenueAmount,
      currentMonthCoins: aggregate.revenueAmount,
      actualLiveMinutes: aggregate.actualLiveMinutes,
      penalties: penalties.toString(),
      violationCount: seenViolations.size,
    },
    components: {
      baseSalary: input.baseSalaryAmount,
      proratedSalary: proratedSalary.toString(),
      dailyRevenueBonus: dailyRevenueBonus.toString(),
      monthlyRevenueBonus: monthlyRevenueBonus.toString(),
      attendanceBonus: attendanceBonus.toString(),
      achievementBonus: achievementBonus.toString(),
      retainLevelBonus: retainLevelBonus.toString(),
      jumpLevelBonus: jumpLevelBonus.toString(),
      levelBonus: levelBonus.toString(),
      overtimePay: overtimePay.toString(),
      otherBonus: otherBonus.toString(),
      penalties: penalties.toString(),
      advance: advance.toString(),
      totalIncome: totalIncome.toString(),
    },
    calculatedComponents: {
      proratedSalary: calculatedProratedSalary.toString(),
      dailyRevenueBonus: calculatedDailyRevenueBonus.toString(),
      monthlyRevenueBonus: calculatedMonthlyRevenueBonus.toString(),
      attendanceBonus: calculatedAttendanceBonus.toString(),
      achievementBonus: calculatedAchievementBonus.toString(),
      retainLevelBonus: calculatedRetainLevelBonus.toString(),
      jumpLevelBonus: calculatedJumpLevelBonus.toString(),
      overtimePay: calculatedOvertimePay.toString(),
      otherBonus: calculatedOtherBonus.toString(),
      penalties: calculatedPenalties.toString(),
      advance: calculatedAdvance.toString(),
      totalIncome: calculatedTotalIncome.toString(),
    },
    salaryBasis: {
      daysInMonth: daysInPayrollMonth(input.period.month),
      standardDaysOffPerMonth: configuredDaysOff,
      standardPayableDays: payableDays,
    },
    employmentSalary: {
      joinedDate: salary.joinedDate,
      officialDate: salary.officialDate,
      probationSalaryRateBps: salary.probationSalaryRateBps,
      probationWorkUnits: salary.probationWorkUnits,
      officialWorkUnits: salary.officialWorkUnits,
      excludedBeforeJoinWorkUnits: salary.excludedBeforeJoinWorkUnits,
      probationSalaryAmount: calculatedProbationSalary.toString(),
      officialSalaryAmount: calculatedOfficialSalary.toString(),
      calculatedProratedSalary: calculatedProratedSalary.toString(),
      fallbackMode: salary.fallbackMode,
    },
    monthlyLevel: {
      workedDayCount,
      attendanceRequiredDays: input.monthlyLevelRule?.attendanceRequiredDays ?? null,
      attendanceEligible,
      previousMonthCoins: input.previousMonth.coins,
      previousMonthCoinsSource: input.previousMonth.source,
      previousLevelCode: input.previousMonth.level?.code ?? null,
      previousLevelName: input.previousMonth.level?.name ?? null,
      previousLevelOrder: input.previousMonth.level?.displayOrder ?? null,
      currentMonthCoins: aggregate.revenueAmount,
      currentLevelCode: suggestedLevelCode,
      currentLevelName: suggestedLevelName,
      currentLevelOrder:
        input.monthlyLevelRule?.levels.find((level) => level.code === suggestedLevelCode)
          ?.displayOrder ?? null,
      transition: monthlyTransition,
    },
    suggestedLevelCode,
    selectedRuleVersionIds,
    anomalyFlags: [
      ...(attendance.length === 0 ? ["NO_ATTENDANCE"] : []),
      ...(salary.excludedBeforeJoinWorkUnits !== "0" ? ["WORK_BEFORE_JOIN_DATE"] : []),
      ...(input.monthlyLevelRule === null ? ["MISSING_MONTHLY_LEVEL_RULE"] : []),
      ...(totalIncome < 0n ? ["NEGATIVE_TOTAL"] : []),
    ],
    lines,
  };
}

const SPREADSHEET_FORMULA_PREFIX = /^[\s]*[=+\-@]/;
const SENSITIVE_AUDIT_KEY =
  /(password|passcode|secret|token|authorization|cookie|session|credential|api[-_]?key|private[-_]?key)/i;

export function sanitizeSpreadsheetText(value: string): string {
  return SPREADSHEET_FORMULA_PREFIX.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? sanitizeSpreadsheetText(value) : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function redactSensitiveAuditValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_AUDIT_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveAuditValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactSensitiveAuditValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export type AuditChange = Readonly<{ path: string; before: unknown; after: unknown }>;

export function diffAuditValues(
  before: unknown,
  after: unknown,
  path = "",
): readonly AuditChange[] {
  if (Object.is(before, after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const beforeRecord = before as Readonly<Record<string, unknown>>;
    const afterRecord = after as Readonly<Record<string, unknown>>;
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();
    return keys.flatMap((childKey) =>
      diffAuditValues(
        beforeRecord[childKey],
        afterRecord[childKey],
        path ? `${path}.${childKey}` : childKey,
      ),
    );
  }
  return [{ path: path || "$", before, after }];
}
