export type AutomaticPenaltyCondition =
  | Readonly<{ type: "MANUAL" }>
  | Readonly<{
      type: "CHECK_IN_LATE";
      scheduledStartMinutes: number;
      graceMinutes: number;
      branchId: string | null;
    }>
  | Readonly<{
      type: "LIVE_DURATION_SHORT";
      requiredLiveMinutes: number;
      graceMinutes: number;
      branchId: string | null;
    }>;

export type AutomaticPenaltyEvaluation = Readonly<{
  status: "PASS" | "VIOLATION" | "INSUFFICIENT_DATA";
  triggerType: Exclude<AutomaticPenaltyCondition["type"], "MANUAL">;
  actualMinutes: number | null;
  configuredMinutes: number;
  graceMinutes: number;
  acceptedThresholdMinutes: number;
  message: string;
}>;

type AutomaticPenaltyAttendance = Readonly<{
  status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE";
  businessDate: string;
  checkInAt: string | null;
  actualLiveMinutes: number;
}>;

function civilDayIndex(businessDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) {
    throw new Error("Ngày nghiệp vụ phải có định dạng YYYY-MM-DD.");
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new Error("Ngày nghiệp vụ không hợp lệ.");
  }
  return Math.floor(value.getTime() / 86_400_000);
}

function civilDateTimeInTimeZone(
  value: Date,
  timeZone: string,
): { dayIndex: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Không thể xác định giờ check-in theo múi giờ nghiệp vụ.");
  }
  return {
    dayIndex: civilDayIndex(`${year}-${month}-${day}`),
    minutes: hour * 60 + minute,
  };
}

export function formatDurationForRule(minutes: number): string {
  const safeMinutes = Math.max(0, Math.trunc(minutes));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, "0")}:${String(
    safeMinutes % 60,
  ).padStart(2, "0")}`;
}

export function evaluateAutomaticPenalty(
  condition: Exclude<AutomaticPenaltyCondition, Readonly<{ type: "MANUAL" }>>,
  attendance: AutomaticPenaltyAttendance,
  timeZone = "Asia/Ho_Chi_Minh",
): AutomaticPenaltyEvaluation {
  if (attendance.status !== "PRESENT") {
    const configuredMinutes =
      condition.type === "CHECK_IN_LATE"
        ? condition.scheduledStartMinutes
        : condition.requiredLiveMinutes;
    return {
      status: "PASS",
      triggerType: condition.type,
      actualMinutes: null,
      configuredMinutes,
      graceMinutes: condition.graceMinutes,
      acceptedThresholdMinutes:
        condition.type === "CHECK_IN_LATE"
          ? configuredMinutes + condition.graceMinutes
          : Math.max(0, configuredMinutes - condition.graceMinutes),
      message: "Không áp dụng vì trạng thái chấm công không phải Có mặt.",
    };
  }

  if (condition.type === "CHECK_IN_LATE") {
    const acceptedThresholdMinutes = condition.scheduledStartMinutes + condition.graceMinutes;
    if (!attendance.checkInAt) {
      return {
        status: "INSUFFICIENT_DATA",
        triggerType: condition.type,
        actualMinutes: null,
        configuredMinutes: condition.scheduledStartMinutes,
        graceMinutes: condition.graceMinutes,
        acceptedThresholdMinutes,
        message: "Chưa có giờ check-in để đánh giá đi muộn.",
      };
    }
    const checkIn = new Date(attendance.checkInAt);
    if (Number.isNaN(checkIn.getTime())) {
      return {
        status: "INSUFFICIENT_DATA",
        triggerType: condition.type,
        actualMinutes: null,
        configuredMinutes: condition.scheduledStartMinutes,
        graceMinutes: condition.graceMinutes,
        acceptedThresholdMinutes,
        message: "Giờ check-in không hợp lệ.",
      };
    }
    const actual = civilDateTimeInTimeZone(checkIn, timeZone);
    const scheduledAbsoluteMinutes =
      civilDayIndex(attendance.businessDate) * 1_440 + acceptedThresholdMinutes;
    const actualAbsoluteMinutes = actual.dayIndex * 1_440 + actual.minutes;
    const actualMinutes = actual.minutes;
    const isViolation = actualAbsoluteMinutes > scheduledAbsoluteMinutes;
    return {
      status: isViolation ? "VIOLATION" : "PASS",
      triggerType: condition.type,
      actualMinutes,
      configuredMinutes: condition.scheduledStartMinutes,
      graceMinutes: condition.graceMinutes,
      acceptedThresholdMinutes,
      message: isViolation
        ? `Check-in ${formatDurationForRule(actualMinutes)}, sau ngưỡng được phép ${formatDurationForRule(acceptedThresholdMinutes)}.`
        : `Check-in ${formatDurationForRule(actualMinutes)}, trong ngưỡng được phép đến ${formatDurationForRule(acceptedThresholdMinutes)}.`,
    };
  }

  const acceptedThresholdMinutes = Math.max(
    0,
    condition.requiredLiveMinutes - condition.graceMinutes,
  );
  const actualMinutes = attendance.actualLiveMinutes;
  const isViolation = actualMinutes < acceptedThresholdMinutes;
  return {
    status: isViolation ? "VIOLATION" : "PASS",
    triggerType: condition.type,
    actualMinutes,
    configuredMinutes: condition.requiredLiveMinutes,
    graceMinutes: condition.graceMinutes,
    acceptedThresholdMinutes,
    message: isViolation
      ? `Live ${formatDurationForRule(actualMinutes)}, dưới ngưỡng tối thiểu ${formatDurationForRule(acceptedThresholdMinutes)}.`
      : `Live ${formatDurationForRule(actualMinutes)}, đạt ngưỡng tối thiểu ${formatDurationForRule(acceptedThresholdMinutes)}.`,
  };
}
