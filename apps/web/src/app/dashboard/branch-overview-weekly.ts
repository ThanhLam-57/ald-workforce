import type { BranchOverviewDayDto, BranchOverviewTotalsDto } from "@ald/contracts";

export type BranchOverviewCalendarDay = Readonly<
  Pick<BranchOverviewDayDto, "businessDate" | "dayOfWeek" | "weekOfMonth">
>;

export type BranchOverviewWeek = Readonly<{
  weekNo: number;
  from: string;
  to: string;
  days: readonly BranchOverviewCalendarDay[];
}>;

export function groupBranchOverviewWeeks(
  calendar: readonly BranchOverviewCalendarDay[],
): readonly BranchOverviewWeek[] {
  const daysByWeek = new Map<number, BranchOverviewCalendarDay[]>();
  for (const day of calendar) {
    const days = daysByWeek.get(day.weekOfMonth) ?? [];
    days.push(day);
    daysByWeek.set(day.weekOfMonth, days);
  }
  return [...daysByWeek.entries()]
    .sort(([left], [right]) => left - right)
    .map(([weekNo, days]) => ({
      weekNo,
      from: days[0]!.businessDate,
      to: days.at(-1)!.businessDate,
      days,
    }));
}

function decimalHundredths(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function formatHundredths(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function overviewTotals(
  days: readonly Pick<
    BranchOverviewDayDto,
    "revenueAmount" | "workUnits" | "actualLiveMinutes" | "overtimeMinutes" | "penaltyAmount"
  >[],
): BranchOverviewTotalsDto {
  return {
    revenueAmount: days
      .reduce((total, day) => total + BigInt(day.revenueAmount), 0n)
      .toString(),
    workUnits: formatHundredths(
      days.reduce((total, day) => total + decimalHundredths(day.workUnits), 0n),
    ),
    actualLiveMinutes: days.reduce((total, day) => total + day.actualLiveMinutes, 0),
    overtimeMinutes: days.reduce((total, day) => total + day.overtimeMinutes, 0),
    penaltyAmount: days
      .reduce((total, day) => total + BigInt(day.penaltyAmount), 0n)
      .toString(),
  };
}
