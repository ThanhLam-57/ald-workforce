export const AUTH_ROLES = ["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export type ActorContext = Readonly<{
  userId: string;
  companyId: string;
  staffId: string | null;
  role: AuthRole;
  activeBranchIds: readonly string[];
}>;

export type ResourceAction =
  | "branch:create"
  | "branch:update"
  | "staff:create"
  | "staff:update"
  | "user:create"
  | "user:update"
  | "assignment:create"
  | "assignment:update"
  | "branch:read"
  | "staff:read"
  | "attendance:read"
  | "attendance:write"
  | "attendance:archive"
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
  | "branch-overview:export";

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
      action === "attendance:read" ||
      action === "attendance:write" ||
      action === "attendance:archive" ||
      action === "attendance:export" ||
      action === "rule:read" ||
      action === "violation:read" ||
      action === "violation:write" ||
      action === "violation:cancel" ||
      action === "evidence:upload" ||
      action === "evidence:read" ||
      action === "branch-overview:read" ||
      action === "branch-overview:write" ||
      action === "branch-overview:export"
    );
  }

  if (actor.role === "LIVE_EMPLOYEE") {
    return action === "rule:read";
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
  transition: "NONE" | "RETAIN" | "JUMP";
}>;

export function calculateMonthlyLevelResult(
  input: Readonly<{
    revenueAmount: string;
    workUnits: string;
    actualLiveMinutes: number;
    currentLevelOrder: number | null;
    currentLevelCode: string | null;
  }>,
  levels: readonly MonthlyLevelTier[],
): MonthlyLevelResult {
  const level = matchRevenueBand(
    input.revenueAmount,
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
  const attendanceEligible =
    level.attendanceMinWorkUnits === null ||
    decimalHundredths(input.workUnits) >= decimalHundredths(level.attendanceMinWorkUnits);
  const achievementEligible =
    level.achievementMinLiveMinutes === null ||
    input.actualLiveMinutes >= level.achievementMinLiveMinutes;
  const transition =
    input.currentLevelCode === level.code
      ? "RETAIN"
      : input.currentLevelOrder !== null &&
          level.displayOrder - input.currentLevelOrder >= level.jumpMinLevelSteps
        ? "JUMP"
        : "NONE";
  const amount =
    BigInt(level.monthlyRevenueBonus) +
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
  const eligible = attendance.filter((row) =>
    rule.attendancePolicy.eligibleStatuses.includes(row.status),
  );
  let worked =
    rule.attendancePolicy.prorateMode === "WORK_UNITS"
      ? eligible.reduce((total, row) => total + decimalHundredths(row.workUnits), 0n)
      : BigInt(eligible.length) * 100n;
  const fullThreshold = rule.attendancePolicy.minimumWorkUnitsForFullSalary;
  if (fullThreshold !== null && worked >= decimalHundredths(fullThreshold)) {
    worked = standardDays;
  }
  if (rule.attendancePolicy.capAtStandardWorkdays && worked > standardDays) {
    worked = standardDays;
  }

  const baseSalary = BigInt(rule.baseSalary);
  const overtimeMinutes = eligible.reduce(
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
