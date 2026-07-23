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
