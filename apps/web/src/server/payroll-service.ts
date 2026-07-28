import { createHash } from "node:crypto";

import {
  configuredRuleSchema,
  payrollWorksheetValuesSchema,
  type DailyRewardConfig,
  type MonthlyLevelConfig,
  type PayrollAdjustmentCreateInput,
  type PayrollDailyRowDto,
  type PayrollEntryDto,
  type PayrollLineDto,
  type PayrollPeriodActionInput,
  type PayrollPeriodCreateInput,
  type PayrollPeriodDto,
  type PayrollPeriodListQuery,
  type PayrollPeriodEnsureInput,
  type PayrollRevisionCreateInput,
  type PayrollWorksheetSaveInput,
  type SalaryConfig,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  calculatePayroll,
  daysInPayrollMonth,
  DomainError,
  matchRevenueBand,
  requirePermission,
  standardPayableDays,
  toBusinessDateString,
  type ActorContext,
  type PayrollCalculationInput,
  type PayrollCalculationOutput,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";

const ENGINE_VERSION = "payroll-v1";
type Transaction = Prisma.TransactionClient;
const PAYROLL_CALCULATION_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead" as const,
  maxWait: 10_000,
  timeout: 60_000,
};

type ResolvedRule = Readonly<{
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  managementMode: "VERSIONED" | "SIMPLE_MUTABLE";
  configuration: DailyRewardConfig | MonthlyLevelConfig | SalaryConfig;
}>;

const periodInclude = {
  branch: { select: { id: true, code: true, name: true } },
  company: { select: { employeeRevenueVisible: true } },
  worksheetOverrides: {
    select: { staffId: true, values: true, version: true },
  },
  entries: {
    where: { included: true },
    include: {
      staff: {
        select: { id: true, staffCode: true, fullName: true, streamingAlias: true },
      },
      currentSnapshot: {
        include: { lines: { orderBy: { displayOrder: "asc" as const } } },
      },
      snapshots: {
        orderBy: { calculationNo: "desc" as const },
        take: 2,
        select: {
          calculationNo: true,
          outputs: true,
          inputs: true,
          inputHash: true,
        },
      },
    },
    orderBy: { staff: { staffCode: "asc" as const } },
  },
} satisfies Prisma.PayrollPeriodInclude;

type PeriodRecord = Prisma.PayrollPeriodGetPayload<{ include: typeof periodInclude }>;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function auditBranchId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const branchId = (value as Readonly<Record<string, unknown>>).branchId;
  return typeof branchId === "string" ? branchId : undefined;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function canonicalPayrollHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

async function appendAudit(
  tx: Transaction,
  input: Readonly<{
    actor: ActorContext;
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    metadata: RequestMetadata;
  }>,
): Promise<void> {
  const branchId = auditBranchId(input.after) ?? auditBranchId(input.before);
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      ...(branchId ? { branchId } : {}),
      actorUserId: input.actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      ...(input.before === undefined ? {} : { before: jsonValue(input.before) }),
      ...(input.after === undefined ? {} : { after: jsonValue(input.after) }),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

function periodBounds(month: string): {
  from: string;
  toExclusive: string;
  monthDate: Date;
  lastDate: string;
} {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const fromDate = new Date(Date.UTC(year, monthIndex, 1));
  const toDate = new Date(Date.UTC(year, monthIndex + 1, 1));
  const last = new Date(toDate);
  last.setUTCDate(last.getUTCDate() - 1);
  return {
    from: fromDate.toISOString().slice(0, 10),
    toExclusive: toDate.toISOString().slice(0, 10),
    monthDate: fromDate,
    lastDate: last.toISOString().slice(0, 10),
  };
}

function previousBusinessMonth(month: string): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 2, 1));
  return date.toISOString().slice(0, 7);
}

function timeInBusinessZone(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function requirePayrollRead(actor: ActorContext): void {
  if (actor.role === "GENERAL_MANAGER") {
    requirePermission(actor, "payroll:read");
    return;
  }
  if (actor.role === "LIVE_EMPLOYEE") {
    requirePermission(actor, "payslip:read");
    if (!actor.staffId) {
      throw new DomainError("FORBIDDEN", "Tài khoản chưa liên kết hồ sơ nhân viên.");
    }
    return;
  }
  throw new DomainError("FORBIDDEN", "Quản lý đào tạo không được truy cập payroll.");
}

function requirePayrollWrite(actor: ActorContext): void {
  requirePermission(actor, "payroll:write");
  if (actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được quản lý Payroll.");
  }
}

async function verifyEmployeeSelfService(
  tx: Transaction | typeof prisma,
  actor: ActorContext,
): Promise<void> {
  if (actor.role !== "LIVE_EMPLOYEE") return;
  const company = await tx.company.findFirst({
    where: { id: actor.companyId, selfServiceEnabled: true },
    select: { id: true },
  });
  if (!company) {
    throw new DomainError("FORBIDDEN", "Self-service chưa được bật cho công ty.");
  }
}

async function loadPeriodForActor(
  tx: Transaction | typeof prisma,
  actor: ActorContext,
  periodId: string,
  write = false,
) {
  if (write) requirePayrollWrite(actor);
  else requirePayrollRead(actor);
  await verifyEmployeeSelfService(tx, actor);
  const period = await tx.payrollPeriod.findFirst({
    where: {
      id: periodId,
      companyId: actor.companyId,
      ...(actor.role === "LIVE_EMPLOYEE"
        ? {
            status: "PUBLISHED",
            entries: { some: { staffId: actor.staffId!, included: true } },
          }
        : {}),
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      month: true,
      revision: true,
      status: true,
      version: true,
      latestCalculationNo: true,
      standardDaysOffOverride: true,
      sourcePeriodId: true,
    },
  });
  if (!period) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy kỳ lương trong phạm vi.");
  }
  return period;
}

function parseStoredOutput(value: Prisma.JsonValue): PayrollCalculationOutput {
  const output = value as unknown as PayrollCalculationOutput;
  const components = output.components;
  const retainLevelBonus = components.retainLevelBonus ?? "0";
  const jumpLevelBonus = components.jumpLevelBonus ?? components.levelBonus;
  const calculatedComponents = output.calculatedComponents ?? {
    proratedSalary: components.proratedSalary,
    dailyRevenueBonus: components.dailyRevenueBonus,
    monthlyRevenueBonus: components.monthlyRevenueBonus,
    attendanceBonus: components.attendanceBonus,
    achievementBonus: components.achievementBonus,
    retainLevelBonus,
    jumpLevelBonus,
    overtimePay: components.overtimePay,
    otherBonus: components.otherBonus,
    penalties: components.penalties,
    advance: components.advance,
    totalIncome: components.totalIncome,
  };
  const aggregates = output.aggregates as PayrollCalculationOutput["aggregates"] &
    Partial<Pick<PayrollCalculationOutput["aggregates"], "workedDayCount" | "currentMonthCoins">>;
  const monthlyLevel = output.monthlyLevel ?? {
    workedDayCount: aggregates.workedDayCount ?? 0,
    attendanceRequiredDays: null,
    attendanceEligible: false,
    previousMonthCoins: null,
    previousMonthCoinsSource: "NONE" as const,
    previousLevelCode: null,
    previousLevelName: null,
    previousLevelOrder: null,
    currentMonthCoins: aggregates.currentMonthCoins ?? aggregates.revenueAmount,
    currentLevelCode: output.suggestedLevelCode ?? null,
    currentLevelName: null,
    currentLevelOrder: null,
    transition: "NONE" as const,
  };
  return {
    ...output,
    aggregates: {
      ...aggregates,
      workedDayCount: aggregates.workedDayCount ?? monthlyLevel.workedDayCount,
      currentMonthCoins: aggregates.currentMonthCoins ?? aggregates.revenueAmount,
    },
    components: {
      ...components,
      retainLevelBonus,
      jumpLevelBonus,
    },
    calculatedComponents,
    salaryBasis: output.salaryBasis ?? {
      daysInMonth: 0,
      standardDaysOffPerMonth: null,
      standardPayableDays: 0,
    },
    employmentSalary: output.employmentSalary ?? {
      joinedDate: null,
      officialDate: null,
      probationSalaryRateBps: 8_500,
      probationWorkUnits: "0",
      officialWorkUnits: aggregates.workUnits,
      excludedBeforeJoinWorkUnits: "0",
      probationSalaryAmount: "0",
      officialSalaryAmount: calculatedComponents.proratedSalary,
      calculatedProratedSalary: calculatedComponents.proratedSalary,
      fallbackMode: "LEGACY_OFFICIAL_WITHOUT_OFFICIAL_DATE",
    },
    monthlyLevel,
  };
}

function parseStoredInput(value: Prisma.JsonValue): PayrollCalculationInput {
  const input = value as unknown as Omit<
    PayrollCalculationInput,
    "baseSalaryAmount" | "previousMonth"
  > & {
    baseSalaryAmount?: string;
    previousMonth?: PayrollCalculationInput["previousMonth"];
  };
  return {
    ...input,
    // Snapshots created before per-staff salary existed remain readable and immutable.
    baseSalaryAmount: input.baseSalaryAmount ?? input.salaryRule.configuration.baseSalary,
    salaryRule: {
      ...input.salaryRule,
      configuration: {
        ...input.salaryRule.configuration,
        probationSalaryRateBps: input.salaryRule.configuration.probationSalaryRateBps ?? 8_500,
      },
    },
    previousMonth: input.previousMonth ?? {
      coins: null,
      source: "NONE",
      level: null,
    },
  };
}

function withoutRevenueDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => {
        const normalized = key.toLowerCase();
        return !normalized.includes("revenue") && !normalized.includes("coin");
      })
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.map((item) =>
              item !== null && typeof item === "object"
                ? withoutRevenueDetails(item as Readonly<Record<string, unknown>>)
                : item,
            )
          : value !== null && typeof value === "object"
            ? withoutRevenueDetails(value as Readonly<Record<string, unknown>>)
            : value,
      ]),
  );
}

function dailyRows(
  input: PayrollCalculationInput,
  output: PayrollCalculationOutput,
  revenueVisible: boolean,
): PayrollDailyRowDto[] {
  const bonusByAttendance = new Map<string, bigint>();
  for (const line of output.lines) {
    if (line.type === "DAILY_REVENUE_BONUS") {
      bonusByAttendance.set(
        line.sourceId,
        (bonusByAttendance.get(line.sourceId) ?? 0n) + BigInt(line.amount),
      );
    }
  }
  return [...input.attendance]
    .sort((left, right) => left.businessDate.localeCompare(right.businessDate))
    .map((row) => {
      const calculatedPenalty = row.violations
        .reduce((total, violation) => total + BigInt(violation.amount), 0n)
        .toString();
      const dailyRevenueBonus =
        row.dailyRevenueBonusOverride ?? (bonusByAttendance.get(row.attendanceId) ?? 0n).toString();
      const source = row.source ?? {
        checkInTime: row.checkInTime ?? null,
        checkOutTime: row.checkOutTime ?? null,
        status: row.status,
        workUnits: row.workUnits,
        overtimeMinutes: row.overtimeMinutes,
        actualLiveMinutes: row.actualLiveMinutes,
        revenueAmount: row.revenueAmount,
        rewardThresholdAmount: row.rewardThresholdAmount ?? null,
        dailyRevenueBonus,
        violationCategory: row.violationCategory ?? null,
        violationDetail: row.violationDetail ?? null,
        penalties: calculatedPenalty,
        note: row.note ?? null,
      };
      return {
        businessDate: row.businessDate,
        checkInTime: row.checkInTime ?? null,
        checkOutTime: row.checkOutTime ?? null,
        status: row.status,
        workUnits: row.workUnits,
        overtimeMinutes: row.overtimeMinutes,
        actualLiveMinutes: row.actualLiveMinutes,
        ...(revenueVisible
          ? {
              revenueAmount: row.revenueAmount,
              dailyCoins: row.revenueAmount,
              rewardThresholdAmount: row.rewardThresholdAmount ?? null,
            }
          : {}),
        dailyRevenueBonus,
        violationCategory: row.violationCategory ?? null,
        violationDetail: row.violationDetail ?? null,
        penalties: row.penaltiesOverride ?? calculatedPenalty,
        note: row.note ?? null,
        source: {
          checkInTime: source.checkInTime,
          checkOutTime: source.checkOutTime,
          status: source.status,
          workUnits: source.workUnits,
          overtimeMinutes: source.overtimeMinutes,
          actualLiveMinutes: source.actualLiveMinutes,
          ...(revenueVisible
            ? {
                revenueAmount: source.revenueAmount,
                dailyCoins: source.revenueAmount,
                rewardThresholdAmount: source.rewardThresholdAmount,
              }
            : {}),
          dailyRevenueBonus: source.dailyRevenueBonus,
          violationCategory: source.violationCategory,
          violationDetail: source.violationDetail,
          penalties: source.penalties,
          note: source.note,
        },
        overriddenFields: row.overriddenFields ?? [],
      };
    });
}

function lineDto(
  line: PeriodRecord["entries"][number]["currentSnapshot"] extends infer Snapshot
    ? Snapshot extends { lines: Array<infer Line> }
      ? Line
      : never
    : never,
  revenueVisible: boolean,
): PayrollLineDto {
  const calculationDetails = line.calculationDetails as Readonly<Record<string, unknown>>;
  return {
    id: line.id,
    type: line.type,
    amount: line.amount.toString(),
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    ruleVersionId: line.ruleVersionId,
    label: line.label,
    calculationDetails: revenueVisible
      ? calculationDetails
      : withoutRevenueDetails(calculationDetails),
    includedInTotal: line.includedInTotal,
  };
}

function entryDto(
  entry: PeriodRecord["entries"][number],
  revenueVisible: boolean,
  worksheetOverride: PeriodRecord["worksheetOverrides"][number] | undefined,
): PayrollEntryDto {
  if (!entry.currentSnapshot) {
    throw new Error(`Payroll entry ${entry.id} thiếu current snapshot.`);
  }
  const output = parseStoredOutput(entry.currentSnapshot.outputs);
  const input = parseStoredInput(entry.currentSnapshot.inputs);
  const previous = entry.snapshots[1];
  const previousTotal = previous
    ? parseStoredOutput(previous.outputs).components.totalIncome
    : null;
  return {
    id: entry.id,
    staff: entry.staff,
    workUnits: entry.workUnits.toString(),
    workedDayCount: output.aggregates.workedDayCount,
    overtimeMinutes: entry.overtimeMinutes,
    ...(revenueVisible
      ? {
          revenueAmount: entry.revenueAmount.toString(),
          currentMonthCoins: output.monthlyLevel.currentMonthCoins,
        }
      : {}),
    actualLiveMinutes: entry.actualLiveMinutes,
    sourceBaseSalary: input.sourceBaseSalaryAmount ?? input.baseSalaryAmount,
    baseSalary: entry.baseSalary.toString(),
    proratedSalary: entry.proratedSalary.toString(),
    dailyRevenueBonus: entry.dailyRevenueBonus.toString(),
    monthlyRevenueBonus: entry.monthlyRevenueBonus.toString(),
    attendanceBonus: entry.attendanceBonus.toString(),
    achievementBonus: entry.achievementBonus.toString(),
    levelBonus: entry.levelBonus.toString(),
    overtimePay: entry.overtimePay.toString(),
    otherBonus: entry.otherBonus.toString(),
    penalties: entry.penalties.toString(),
    advance: entry.advance.toString(),
    totalIncome: entry.totalIncome.toString(),
    calculatedComponents: output.calculatedComponents,
    previousLevelCode:
      output.monthlyLevel.previousLevelCode ?? input.levelDisplay?.previousLevelCode ?? null,
    sourceCurrentLevelCode:
      input.levelDisplay?.sourceCurrentLevelCode ?? input.currentLevel?.code ?? null,
    sourceCurrentLevelName: input.levelDisplay?.sourceCurrentLevelName ?? null,
    currentLevelCode:
      output.monthlyLevel.currentLevelCode ??
      input.levelDisplay?.currentLevelCode ??
      input.currentLevel?.code ??
      null,
    currentLevelName:
      output.monthlyLevel.currentLevelName ?? input.levelDisplay?.currentLevelName ?? null,
    monthlyLevel: {
      workedDayCount: output.monthlyLevel.workedDayCount,
      attendanceRequiredDays: output.monthlyLevel.attendanceRequiredDays,
      attendanceEligible: output.monthlyLevel.attendanceEligible,
      ...(revenueVisible
        ? {
            previousMonthCoins: output.monthlyLevel.previousMonthCoins,
            currentMonthCoins: output.monthlyLevel.currentMonthCoins,
          }
        : {}),
      previousMonthCoinsSource: output.monthlyLevel.previousMonthCoinsSource,
      previousLevelCode: output.monthlyLevel.previousLevelCode,
      previousLevelName: output.monthlyLevel.previousLevelName,
      currentLevelCode: output.monthlyLevel.currentLevelCode,
      currentLevelName: output.monthlyLevel.currentLevelName,
      transition: output.monthlyLevel.transition,
    },
    employmentSalary: output.employmentSalary,
    worksheetOverride:
      revenueVisible && worksheetOverride
        ? {
            version: worksheetOverride.version,
            values: payrollWorksheetValuesSchema.parse(worksheetOverride.values),
          }
        : null,
    anomalyFlags: entry.anomalyFlags as string[],
    calculationHash: entry.currentSnapshot.inputHash,
    calculationNo: entry.currentSnapshot.calculationNo,
    lines: entry.currentSnapshot.lines.map((line) => lineDto(line, revenueVisible)),
    dailyRows: dailyRows(input, output, revenueVisible),
    previousTotalIncome: previousTotal,
    deltaFromPrevious:
      previousTotal === null ? null : (entry.totalIncome - BigInt(previousTotal)).toString(),
  };
}

function periodDto(record: PeriodRecord, actor: ActorContext): PayrollPeriodDto {
  const entries = record.entries
    .filter((entry) => actor.role !== "LIVE_EMPLOYEE" || entry.staffId === actor.staffId)
    .map((entry) =>
      entryDto(
        entry,
        actor.role !== "LIVE_EMPLOYEE" || record.company.employeeRevenueVisible,
        record.worksheetOverrides.find((item) => item.staffId === entry.staffId),
      ),
    );
  const firstSnapshot = record.entries[0]?.currentSnapshot;
  const firstOutput = firstSnapshot ? parseStoredOutput(firstSnapshot.outputs) : null;
  const firstInput = firstSnapshot ? parseStoredInput(firstSnapshot.inputs) : null;
  const totals = entries.reduce(
    (total, entry) => ({
      grossIncome:
        total.grossIncome +
        BigInt(entry.proratedSalary) +
        BigInt(entry.dailyRevenueBonus) +
        BigInt(entry.monthlyRevenueBonus) +
        BigInt(entry.attendanceBonus) +
        BigInt(entry.achievementBonus) +
        BigInt(entry.levelBonus) +
        BigInt(entry.overtimePay) +
        BigInt(entry.otherBonus),
      penalties: total.penalties + BigInt(entry.penalties),
      advance: total.advance + BigInt(entry.advance),
      totalIncome: total.totalIncome + BigInt(entry.totalIncome),
    }),
    { grossIncome: 0n, penalties: 0n, advance: 0n, totalIncome: 0n },
  );
  return {
    id: record.id,
    branch: record.branch,
    month: record.month.toISOString().slice(0, 7),
    revision: record.revision,
    status: record.status,
    version: record.version,
    sourcePeriodId: record.sourcePeriodId,
    latestCalculationNo: record.latestCalculationNo,
    standardDaysOff: {
      ruleValue:
        firstInput &&
        Object.prototype.hasOwnProperty.call(firstInput.salaryRule, "sourceStandardDaysOffPerMonth")
          ? (firstInput.salaryRule.sourceStandardDaysOffPerMonth ?? null)
          : (firstInput?.salaryRule.configuration.standardDaysOffPerMonth ?? null),
      overrideValue: record.standardDaysOffOverride,
      appliedValue: firstOutput?.salaryBasis.standardDaysOffPerMonth ?? null,
      daysInMonth: daysInPayrollMonth(record.month.toISOString().slice(0, 7)),
      standardPayableDays: firstOutput?.salaryBasis.standardPayableDays ?? null,
    },
    salaryPolicy: {
      standardDailyMinutes: firstInput?.salaryRule.configuration.standardDailyMinutes ?? null,
      overtimeMultiplierBps: firstInput?.salaryRule.configuration.overtime.multiplierBps ?? null,
      roundingUnit: firstInput?.salaryRule.configuration.roundingPolicy.unit ?? null,
      roundingMode: firstInput?.salaryRule.configuration.roundingPolicy.mode ?? null,
      roundingApplyAt: firstInput?.salaryRule.configuration.roundingPolicy.applyAt ?? null,
    },
    totals: {
      staffCount: entries.length,
      grossIncome: totals.grossIncome.toString(),
      penalties: totals.penalties.toString(),
      advance: totals.advance.toString(),
      totalIncome: totals.totalIncome.toString(),
    },
    calculatedAt: record.calculatedAt?.toISOString() ?? null,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    lockedAt: record.lockedAt?.toISOString() ?? null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    entries,
  };
}

async function getPeriodRecord(
  tx: Transaction | typeof prisma,
  actor: ActorContext,
  periodId: string,
): Promise<PeriodRecord> {
  const record = await tx.payrollPeriod.findFirst({
    where: {
      id: periodId,
      companyId: actor.companyId,
      ...(actor.role === "LIVE_EMPLOYEE"
        ? { status: "PUBLISHED", entries: { some: { staffId: actor.staffId!, included: true } } }
        : {}),
    },
    include: periodInclude,
  });
  if (!record) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy kỳ lương trong phạm vi.");
  }
  return record;
}

export async function listPayrollPeriods(
  actor: ActorContext,
  query: PayrollPeriodListQuery,
): Promise<readonly PayrollPeriodDto[]> {
  requirePayrollRead(actor);
  await verifyEmployeeSelfService(prisma, actor);
  const month = query.month ? periodBounds(query.month).monthDate : undefined;
  const records = await prisma.payrollPeriod.findMany({
    where: {
      companyId: actor.companyId,
      ...(query.branchId && actor.role !== "LIVE_EMPLOYEE" ? { branchId: query.branchId } : {}),
      ...(month ? { month } : {}),
      ...(actor.role === "LIVE_EMPLOYEE"
        ? {
            status: "PUBLISHED",
            entries: { some: { staffId: actor.staffId!, included: true } },
          }
        : {}),
    },
    include: periodInclude,
    orderBy: [{ month: "desc" }, { revision: "desc" }],
    take: 24,
  });
  const latestByBranchMonth = new Map<string, PeriodRecord>();
  for (const record of records) {
    const key = `${record.branchId}:${record.month.toISOString().slice(0, 7)}`;
    if (!latestByBranchMonth.has(key)) latestByBranchMonth.set(key, record);
  }
  return [...latestByBranchMonth.values()].map((record) => periodDto(record, actor));
}

export async function listPayrollBranches(
  actor: ActorContext,
): Promise<readonly Readonly<{ id: string; code: string; name: string }>[]> {
  requirePayrollRead(actor);
  if (actor.role === "LIVE_EMPLOYEE") return [];
  return prisma.branch.findMany({
    where: { companyId: actor.companyId },
    select: { id: true, code: true, name: true },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });
}

export async function getPayrollPeriod(
  actor: ActorContext,
  periodId: string,
): Promise<PayrollPeriodDto> {
  requirePayrollRead(actor);
  await verifyEmployeeSelfService(prisma, actor);
  return periodDto(await getPeriodRecord(prisma, actor, periodId), actor);
}

export async function createPayrollPeriod(
  actor: ActorContext,
  input: PayrollPeriodCreateInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  await enforceSensitiveMutationRateLimit(actor, "payroll.create", {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  const bounds = periodBounds(input.month);
  const periodId = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, companyId: actor.companyId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
    const existing = await tx.payrollPeriod.findFirst({
      where: { companyId: actor.companyId, branchId: input.branchId, month: bounds.monthDate },
      select: { id: true },
    });
    if (existing) {
      throw new DomainError(
        "CONFLICT",
        "Kỳ lương tháng này đã tồn tại; hãy tạo revision từ kỳ hiện có.",
      );
    }
    const created = await tx.payrollPeriod.create({
      data: {
        companyId: actor.companyId,
        branchId: input.branchId,
        month: bounds.monthDate,
        revision: 1,
        createdByUserId: actor.userId,
        creationReason: input.reason,
      },
      select: { id: true },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_PERIOD_CREATE",
      entityType: "PayrollPeriod",
      entityId: created.id,
      reason: input.reason,
      after: { branchId: input.branchId, month: input.month, revision: 1, status: "DRAFT" },
      metadata,
    });
    return created.id;
  });
  return getPayrollPeriod(actor, periodId);
}

export async function ensurePayrollPeriod(
  actor: ActorContext,
  input: PayrollPeriodEnsureInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  const bounds = periodBounds(input.month);
  const periodId = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!branch) throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
    const lockKey = `payroll-period:${actor.companyId}:${input.branchId}:${input.month}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    const existing = await tx.payrollPeriod.findFirst({
      where: {
        companyId: actor.companyId,
        branchId: input.branchId,
        month: bounds.monthDate,
      },
      orderBy: { revision: "desc" },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.payrollPeriod.create({
      data: {
        companyId: actor.companyId,
        branchId: input.branchId,
        month: bounds.monthDate,
        revision: 1,
        createdByUserId: actor.userId,
        creationReason: input.reason,
      },
      select: { id: true },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_PERIOD_ENSURE_CREATE",
      entityType: "PayrollPeriod",
      entityId: created.id,
      reason: input.reason,
      after: {
        branchId: input.branchId,
        month: input.month,
        revision: 1,
        status: "DRAFT",
      },
      metadata,
    });
    return created.id;
  });
  return getPayrollPeriod(actor, periodId);
}

async function loadResolvedRules(
  tx: Transaction,
  companyId: string,
  bounds: ReturnType<typeof periodBounds>,
): Promise<ResolvedRule[]> {
  await tx.ruleVersion.updateMany({
    where: {
      companyId,
      isSimpleCurrent: true,
      supersededAt: null,
      status: "SCHEDULED",
      effectiveFrom: { lte: parseBusinessDate(toBusinessDateString(new Date())) },
      ruleSet: {
        companyId,
        managementMode: "SIMPLE_MUTABLE",
      },
    },
    data: {
      status: "ACTIVE",
      rowVersion: { increment: 1 },
    },
  });
  const records = await tx.ruleVersion.findMany({
    where: {
      companyId,
      status: { not: "DRAFT" },
      effectiveFrom: { lt: parseBusinessDate(bounds.toExclusive) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseBusinessDate(bounds.from) } }],
      AND: [
        {
          OR: [
            {
              isSimpleCurrent: true,
              supersededAt: null,
              ruleSet: {
                companyId,
                type: {
                  in: ["DAILY_REWARD_TIERS", "MONTHLY_LEVEL_RULES", "SALARY_RULES"],
                },
                managementMode: "SIMPLE_MUTABLE",
              },
            },
            {
              ruleSet: {
                companyId,
                type: {
                  in: ["DAILY_REWARD_TIERS", "MONTHLY_LEVEL_RULES", "SALARY_RULES"],
                },
                managementMode: "VERSIONED",
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      configuration: true,
      ruleSet: { select: { managementMode: true } },
    },
    orderBy: [{ effectiveFrom: "asc" }, { versionNo: "asc" }],
  });
  return records.flatMap((record) => {
    if (!record.effectiveFrom) return [];
    const parsed = configuredRuleSchema.safeParse(record.configuration);
    return parsed.success &&
      (parsed.data.kind === "DAILY_REWARD_TIERS" ||
        parsed.data.kind === "MONTHLY_LEVEL_RULES" ||
        parsed.data.kind === "SALARY_RULES")
      ? [
          {
            id: record.id,
            effectiveFrom: record.effectiveFrom,
            effectiveTo: record.effectiveTo,
            managementMode: record.ruleSet.managementMode,
            configuration: parsed.data,
          },
        ]
      : [];
  });
}

function rulesAt<T extends ResolvedRule["configuration"]["kind"]>(
  rules: readonly ResolvedRule[],
  kind: T,
  date: string,
): Array<ResolvedRule & { configuration: Extract<ResolvedRule["configuration"], { kind: T }> }> {
  return rules.filter(
    (
      rule,
    ): rule is ResolvedRule & {
      configuration: Extract<ResolvedRule["configuration"], { kind: T }>;
    } =>
      rule.configuration.kind === kind &&
      rule.effectiveFrom.toISOString().slice(0, 10) <= date &&
      (rule.effectiveTo === null || date < rule.effectiveTo.toISOString().slice(0, 10)),
  );
}

function uniqueRuleAt<T extends ResolvedRule["configuration"]["kind"]>(
  rules: readonly ResolvedRule[],
  kind: T,
  date: string,
  required: boolean,
) {
  const candidates = rulesAt(rules, kind, date);
  const simpleMatches =
    kind === "DAILY_REWARD_TIERS" || kind === "MONTHLY_LEVEL_RULES" || kind === "SALARY_RULES"
      ? candidates.filter((rule) => rule.managementMode === "SIMPLE_MUTABLE")
      : [];
  const matches =
    simpleMatches.length > 0
      ? simpleMatches
      : candidates.filter((rule) => rule.managementMode === "VERSIONED");
  if (matches.length > 1) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Có nhiều ${kind} cùng hiệu lực ngày ${date}; không thể tính payroll.`,
    );
  }
  if (required && matches.length === 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Thiếu ${kind} hiệu lực ngày ${date}; không thể tính payroll.`,
    );
  }
  return matches[0] ?? null;
}

async function buildCalculations(
  tx: Transaction,
  actor: ActorContext,
  period: Awaited<ReturnType<typeof loadPeriodForActor>>,
): Promise<
  Array<{
    staffId: string;
    input: PayrollCalculationInput;
    inputHash: string;
    output: PayrollCalculationOutput;
    outputHash: string;
  }>
> {
  const month = period.month.toISOString().slice(0, 7);
  const bounds = periodBounds(month);
  const fromDate = parseBusinessDate(bounds.from);
  const toDate = parseBusinessDate(bounds.toExclusive);
  const lastDate = parseBusinessDate(bounds.lastDate);
  const previousBounds = periodBounds(previousBusinessMonth(month));
  const previousFromDate = parseBusinessDate(previousBounds.from);
  const previousToDate = parseBusinessDate(previousBounds.toExclusive);
  const rules = await loadResolvedRules(tx, actor.companyId, bounds);
  const salary = uniqueRuleAt(rules, "SALARY_RULES", bounds.from, true);
  if (!salary || salary.configuration.kind !== "SALARY_RULES") {
    throw new DomainError("VALIDATION_ERROR", "Thiếu salary rule.");
  }
  if (
    salary.effectiveTo !== null &&
    salary.effectiveTo.toISOString().slice(0, 10) < bounds.toExclusive
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Salary rule không bao phủ trọn tháng. Hãy chốt policy đổi rule giữa kỳ.",
    );
  }
  const monthly = uniqueRuleAt(rules, "MONTHLY_LEVEL_RULES", bounds.lastDate, false);
  const assignments = await tx.branchAssignment.findMany({
    where: {
      companyId: actor.companyId,
      branchId: period.branchId,
      effectiveFrom: { lt: toDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: fromDate } }],
    },
    select: {
      staff: {
        select: {
          id: true,
          baseSalaryAmount: true,
          joinedDate: true,
          officialDate: true,
          employmentCategory: true,
        },
      },
    },
    distinct: ["staffId"],
  });
  const staffById = new Map(
    assignments.map((assignment) => [assignment.staff.id, assignment.staff]),
  );
  const staffIds = [...staffById.keys()].sort();
  if (staffIds.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Cơ sở không có nhân viên trong kỳ.");
  }
  const [
    attendance,
    adjustments,
    levels,
    worksheetOverrides,
    previousPublishedEntries,
    previousAttendance,
  ] = await Promise.all([
    tx.attendanceDay.findMany({
      where: {
        companyId: actor.companyId,
        branchId: period.branchId,
        staffId: { in: staffIds },
        businessDate: { gte: fromDate, lt: toDate },
        archivedAt: null,
      },
      select: {
        id: true,
        staffId: true,
        businessDate: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        workUnits: true,
        overtimeMinutes: true,
        note: true,
        liveMetric: { select: { actualLiveMinutes: true, revenueAmount: true } },
        violations: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            ruleVersionId: true,
            amount: true,
            itemName: true,
            detail: true,
          },
        },
      },
      orderBy: [{ staffId: "asc" }, { businessDate: "asc" }],
    }),
    tx.payrollAdjustment.findMany({
      where: { companyId: actor.companyId, payrollPeriodId: period.id },
      select: { id: true, staffId: true, type: true, amount: true, reason: true },
      orderBy: { id: "asc" },
    }),
    tx.levelHistory.findMany({
      where: {
        companyId: actor.companyId,
        staffId: { in: staffIds },
        effectiveFrom: { lte: lastDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: lastDate } }],
      },
      select: {
        staffId: true,
        performanceLevel: { select: { code: true, name: true, displayOrder: true } },
      },
    }),
    tx.payrollWorksheetOverride.findMany({
      where: {
        companyId: actor.companyId,
        branchId: period.branchId,
        payrollPeriodId: period.id,
        staffId: { in: staffIds },
      },
      select: { staffId: true, values: true },
    }),
    tx.payrollEntry.findMany({
      where: {
        companyId: actor.companyId,
        staffId: { in: staffIds },
        included: true,
        currentSnapshotId: { not: null },
        payrollPeriod: {
          companyId: actor.companyId,
          month: previousBounds.monthDate,
          status: "PUBLISHED",
        },
      },
      select: {
        staffId: true,
        revenueAmount: true,
        currentSnapshot: { select: { outputs: true } },
        payrollPeriod: { select: { revision: true, publishedAt: true } },
      },
    }),
    tx.attendanceDay.findMany({
      where: {
        companyId: actor.companyId,
        staffId: { in: staffIds },
        businessDate: { gte: previousFromDate, lt: previousToDate },
        archivedAt: null,
      },
      select: {
        id: true,
        staffId: true,
        liveMetric: { select: { revenueAmount: true } },
      },
    }),
  ]);
  const levelByStaff = new Map(levels.map((item) => [item.staffId, item.performanceLevel]));
  const overrideByStaff = new Map(
    worksheetOverrides.map((item) => [
      item.staffId,
      payrollWorksheetValuesSchema.parse(item.values),
    ]),
  );
  const publishedByStaff = new Map<string, (typeof previousPublishedEntries)[number]>();
  for (const entry of [...previousPublishedEntries].sort((left, right) => {
    const revision = right.payrollPeriod.revision - left.payrollPeriod.revision;
    if (revision !== 0) return revision;
    return (
      (right.payrollPeriod.publishedAt?.getTime() ?? 0) -
      (left.payrollPeriod.publishedAt?.getTime() ?? 0)
    );
  })) {
    if (!publishedByStaff.has(entry.staffId)) publishedByStaff.set(entry.staffId, entry);
  }
  const previousAttendanceByStaff = new Map<
    string,
    Readonly<{ coins: bigint; rowCount: number }>
  >();
  for (const row of previousAttendance) {
    const current = previousAttendanceByStaff.get(row.staffId) ?? { coins: 0n, rowCount: 0 };
    previousAttendanceByStaff.set(row.staffId, {
      coins: current.coins + (row.liveMetric?.revenueAmount ?? 0n),
      rowCount: current.rowCount + 1,
    });
  }
  return staffIds.map((staffId) => {
    const worksheet = overrideByStaff.get(staffId);
    const dayOverrides = new Map((worksheet?.days ?? []).map((day) => [day.businessDate, day]));
    const staffSalary = staffById.get(staffId)!.baseSalaryAmount.toString();
    const storedLevel = levelByStaff.get(staffId) ?? null;
    const monthlyLevels =
      monthly?.configuration.kind === "MONTHLY_LEVEL_RULES" ? monthly.configuration.levels : [];
    const levelFromCoins = (coins: string) => {
      const matched = matchRevenueBand(
        coins,
        monthlyLevels.map((level) => ({ ...level, priority: level.displayOrder })),
      );
      return matched
        ? {
            code: matched.code,
            name: matched.name,
            displayOrder: matched.displayOrder,
          }
        : null;
    };
    const published = publishedByStaff.get(staffId);
    const previousSource = previousAttendanceByStaff.get(staffId);
    let previousMonth: PayrollCalculationInput["previousMonth"];
    if (published?.currentSnapshot) {
      const previousOutput = parseStoredOutput(published.currentSnapshot.outputs);
      const coins =
        previousOutput.monthlyLevel.currentMonthCoins ?? published.revenueAmount.toString();
      const snapshotLevel =
        previousOutput.monthlyLevel.currentLevelCode === null
          ? null
          : {
              code: previousOutput.monthlyLevel.currentLevelCode,
              name:
                previousOutput.monthlyLevel.currentLevelName ??
                previousOutput.monthlyLevel.currentLevelCode,
              displayOrder:
                previousOutput.monthlyLevel.currentLevelOrder ??
                monthlyLevels.find(
                  (level) => level.code === previousOutput.monthlyLevel.currentLevelCode,
                )?.displayOrder ??
                0,
            };
      previousMonth = {
        coins,
        source: "PUBLISHED_PAYROLL",
        level: snapshotLevel?.displayOrder ? snapshotLevel : levelFromCoins(coins),
      };
    } else if (previousSource && previousSource.rowCount > 0) {
      const coins = previousSource.coins.toString();
      previousMonth = {
        coins,
        source: "ATTENDANCE_LIVE",
        level: levelFromCoins(coins),
      };
    } else if (typeof worksheet?.previousMonthCoins === "string") {
      previousMonth = {
        coins: worksheet.previousMonthCoins,
        source: "MANUAL_BASELINE",
        level: levelFromCoins(worksheet.previousMonthCoins),
      };
    } else {
      previousMonth = { coins: null, source: "NONE", level: null };
    }
    const { standardDaysOffPerMonth: configuredDaysOff, ...salaryConfiguration } =
      salary.configuration;
    const componentOverrides = worksheet
      ? (Object.fromEntries(
          Object.entries(worksheet.components).filter(([, value]) => value !== undefined),
        ) as NonNullable<PayrollCalculationInput["componentOverrides"]>)
      : undefined;
    const input: PayrollCalculationInput = {
      staffId,
      baseSalaryAmount: worksheet?.baseSalaryAmount ?? staffSalary,
      sourceBaseSalaryAmount: staffSalary,
      employment: {
        joinedDate: staffById.get(staffId)!.joinedDate?.toISOString().slice(0, 10) ?? null,
        officialDate: staffById.get(staffId)!.officialDate?.toISOString().slice(0, 10) ?? null,
        category: staffById.get(staffId)!.employmentCategory,
      },
      period: {
        month,
        from: bounds.from,
        toExclusive: bounds.toExclusive,
        timezone: "Asia/Ho_Chi_Minh",
      },
      salaryRule: {
        ruleVersionId: salary.id,
        sourceStandardDaysOffPerMonth: configuredDaysOff ?? null,
        configuration: {
          ...salaryConfiguration,
          probationSalaryRateBps: salaryConfiguration.probationSalaryRateBps ?? 8_500,
          ...(period.standardDaysOffOverride === null
            ? configuredDaysOff === undefined
              ? {}
              : { standardDaysOffPerMonth: configuredDaysOff }
            : { standardDaysOffPerMonth: period.standardDaysOffOverride }),
        },
      },
      monthlyLevelRule:
        monthly?.configuration.kind === "MONTHLY_LEVEL_RULES"
          ? {
              ruleVersionId: monthly.id,
              attendanceRequiredDays: monthly.configuration.attendanceRequiredDays ?? 26,
              levels: monthly.configuration.levels,
            }
          : null,
      previousMonth,
      currentLevel: null,
      levelDisplay: {
        previousLevelCode: previousMonth.level?.code ?? null,
        sourceCurrentLevelCode: storedLevel?.code ?? null,
        sourceCurrentLevelName: storedLevel?.name ?? null,
        currentLevelCode: null,
        currentLevelName: null,
      },
      ...(componentOverrides ? { componentOverrides } : {}),
      attendance: attendance
        .filter((row) => row.staffId === staffId)
        .map((row) => {
          const businessDate = row.businessDate.toISOString().slice(0, 10);
          const daily = uniqueRuleAt(rules, "DAILY_REWARD_TIERS", businessDate, false);
          const dayOverride = dayOverrides.get(businessDate);
          const sourceRevenue = row.liveMetric?.revenueAmount.toString() ?? "0";
          const matchedTier =
            daily?.configuration.kind === "DAILY_REWARD_TIERS"
              ? matchRevenueBand(sourceRevenue, daily.configuration.tiers)
              : null;
          const sourceDailyBonus = matchedTier?.rewardAmount ?? "0";
          const sourcePenalty = row.violations
            .reduce((total, violation) => total + violation.amount, 0n)
            .toString();
          const sourceViolationCategory =
            [...new Set(row.violations.map((violation) => violation.itemName))].join(", ") || null;
          const sourceViolationDetail =
            row.violations
              .map((violation) => violation.detail)
              .filter(Boolean)
              .join("; ") || null;
          const source = {
            checkInTime: timeInBusinessZone(row.checkInAt),
            checkOutTime: timeInBusinessZone(row.checkOutAt),
            status: row.status,
            workUnits: row.workUnits.toString(),
            overtimeMinutes: row.overtimeMinutes,
            actualLiveMinutes: row.liveMetric?.actualLiveMinutes ?? 0,
            revenueAmount: sourceRevenue,
            rewardThresholdAmount: matchedTier?.minRevenue ?? null,
            dailyRevenueBonus: sourceDailyBonus,
            violationCategory: sourceViolationCategory,
            violationDetail: sourceViolationDetail,
            penalties: sourcePenalty,
            note: row.note,
          } as const;
          const has = (key: keyof NonNullable<typeof dayOverride>) =>
            dayOverride ? Object.prototype.hasOwnProperty.call(dayOverride, key) : false;
          return {
            attendanceId: row.id,
            businessDate,
            checkInTime: has("checkInTime") ? dayOverride!.checkInTime! : source.checkInTime,
            checkOutTime: has("checkOutTime") ? dayOverride!.checkOutTime! : source.checkOutTime,
            status: dayOverride?.status ?? source.status,
            workUnits: dayOverride?.workUnits ?? source.workUnits,
            overtimeMinutes: dayOverride?.overtimeMinutes ?? source.overtimeMinutes,
            actualLiveMinutes: dayOverride?.actualLiveMinutes ?? source.actualLiveMinutes,
            revenueAmount: dayOverride?.revenueAmount ?? source.revenueAmount,
            rewardThresholdAmount: has("rewardThresholdAmount")
              ? dayOverride!.rewardThresholdAmount!
              : source.rewardThresholdAmount,
            ...(has("dailyRevenueBonus")
              ? { dailyRevenueBonusOverride: dayOverride!.dailyRevenueBonus! }
              : {}),
            ...(has("penalties") ? { penaltiesOverride: dayOverride!.penalties! } : {}),
            violationCategory: has("violationCategory")
              ? dayOverride!.violationCategory!
              : source.violationCategory,
            violationDetail: has("violationDetail")
              ? dayOverride!.violationDetail!
              : source.violationDetail,
            note: has("note") ? dayOverride!.note! : source.note,
            overriddenFields: dayOverride
              ? Object.keys(dayOverride).filter((key) => key !== "businessDate")
              : [],
            source,
            dailyRewardRule:
              daily?.configuration.kind === "DAILY_REWARD_TIERS"
                ? { ruleVersionId: daily.id, tiers: daily.configuration.tiers }
                : null,
            violations: row.violations.map((violation) => ({
              violationId: violation.id,
              ruleVersionId: violation.ruleVersionId,
              amount: violation.amount.toString(),
              itemName: violation.itemName,
            })),
          };
        }),
      adjustments: adjustments
        .filter((adjustment) => adjustment.staffId === staffId)
        .map((adjustment) => ({
          adjustmentId: adjustment.id,
          type: adjustment.type,
          amount: adjustment.amount.toString(),
          reason: adjustment.reason,
        })),
    };
    const output = calculatePayroll(input);
    return {
      staffId,
      input,
      inputHash: canonicalPayrollHash(input),
      output,
      outputHash: canonicalPayrollHash(output),
    };
  });
}

export async function calculatePayrollPeriod(
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  await prisma.$transaction(async (tx) => {
    const period = await loadPeriodForActor(tx, actor, periodId, true);
    if (!["DRAFT", "CALCULATED", "REVIEWED"].includes(period.status)) {
      throw new DomainError("CONFLICT", "Kỳ lương đã khóa, không thể tính lại.");
    }
    if (period.version !== input.version) {
      throw new DomainError("CONFLICT", "Kỳ lương đã được cập nhật. Hãy tải lại.");
    }
    const calculations = await buildCalculations(tx, actor, period);
    const existing = await tx.payrollEntry.findMany({
      where: { payrollPeriodId: period.id, included: true },
      select: {
        staffId: true,
        currentSnapshot: { select: { inputHash: true } },
      },
    });
    const unchanged =
      existing.length === calculations.length &&
      calculations.every(
        (calculation) =>
          existing.find((entry) => entry.staffId === calculation.staffId)?.currentSnapshot
            ?.inputHash === calculation.inputHash,
      );
    if (unchanged) return;

    const calculationNo = period.latestCalculationNo + 1;
    await tx.payrollEntry.updateMany({
      where: { payrollPeriodId: period.id },
      data: { included: false, version: { increment: 1 } },
    });
    for (const calculation of calculations) {
      const components = calculation.output.components;
      const entry = await tx.payrollEntry.upsert({
        where: {
          payrollPeriodId_staffId: {
            payrollPeriodId: period.id,
            staffId: calculation.staffId,
          },
        },
        create: {
          companyId: actor.companyId,
          branchId: period.branchId,
          payrollPeriodId: period.id,
          staffId: calculation.staffId,
          included: true,
          workUnits: calculation.output.aggregates.workUnits,
          overtimeMinutes: calculation.output.aggregates.overtimeMinutes,
          revenueAmount: BigInt(calculation.output.aggregates.revenueAmount),
          actualLiveMinutes: calculation.output.aggregates.actualLiveMinutes,
          baseSalary: BigInt(components.baseSalary),
          proratedSalary: BigInt(components.proratedSalary),
          dailyRevenueBonus: BigInt(components.dailyRevenueBonus),
          monthlyRevenueBonus: BigInt(components.monthlyRevenueBonus),
          attendanceBonus: BigInt(components.attendanceBonus),
          achievementBonus: BigInt(components.achievementBonus),
          levelBonus: BigInt(components.levelBonus),
          overtimePay: BigInt(components.overtimePay),
          otherBonus: BigInt(components.otherBonus),
          penalties: BigInt(components.penalties),
          advance: BigInt(components.advance),
          totalIncome: BigInt(components.totalIncome),
          anomalyFlags: jsonValue(calculation.output.anomalyFlags),
        },
        update: {
          included: true,
          workUnits: calculation.output.aggregates.workUnits,
          overtimeMinutes: calculation.output.aggregates.overtimeMinutes,
          revenueAmount: BigInt(calculation.output.aggregates.revenueAmount),
          actualLiveMinutes: calculation.output.aggregates.actualLiveMinutes,
          baseSalary: BigInt(components.baseSalary),
          proratedSalary: BigInt(components.proratedSalary),
          dailyRevenueBonus: BigInt(components.dailyRevenueBonus),
          monthlyRevenueBonus: BigInt(components.monthlyRevenueBonus),
          attendanceBonus: BigInt(components.attendanceBonus),
          achievementBonus: BigInt(components.achievementBonus),
          levelBonus: BigInt(components.levelBonus),
          overtimePay: BigInt(components.overtimePay),
          otherBonus: BigInt(components.otherBonus),
          penalties: BigInt(components.penalties),
          advance: BigInt(components.advance),
          totalIncome: BigInt(components.totalIncome),
          anomalyFlags: jsonValue(calculation.output.anomalyFlags),
          version: { increment: 1 },
        },
        select: { id: true },
      });
      const snapshot = await tx.calculationSnapshot.create({
        data: {
          companyId: actor.companyId,
          branchId: period.branchId,
          payrollPeriodId: period.id,
          payrollEntryId: entry.id,
          calculationNo,
          inputHash: calculation.inputHash,
          outputHash: calculation.outputHash,
          engineVersion: ENGINE_VERSION,
          inputs: jsonValue(calculation.input),
          selectedRuleVersions: jsonValue(calculation.output.selectedRuleVersionIds),
          roundingPolicy: jsonValue(calculation.input.salaryRule.configuration.roundingPolicy),
          outputs: jsonValue(calculation.output),
          calculatedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await tx.payrollLine.createMany({
        data: calculation.output.lines.map((line, displayOrder) => ({
          companyId: actor.companyId,
          branchId: period.branchId,
          payrollEntryId: entry.id,
          calculationSnapshotId: snapshot.id,
          type: line.type,
          amount: BigInt(line.amount),
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          ruleVersionId: line.ruleVersionId,
          label: line.label,
          calculationDetails: jsonValue(line.calculationDetails),
          includedInTotal: line.includedInTotal,
          displayOrder,
        })),
      });
      await tx.payrollEntry.update({
        where: { id: entry.id },
        data: { currentSnapshotId: snapshot.id },
      });
    }
    const now = new Date();
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        latestCalculationNo: calculationNo,
        status: "CALCULATED",
        calculatedAt: now,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReason: null,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_CALCULATE",
      entityType: "PayrollPeriod",
      entityId: period.id,
      reason: input.reason,
      before: {
        status: period.status,
        version: period.version,
        calculationNo: period.latestCalculationNo,
      },
      after: {
        status: "CALCULATED",
        calculationNo,
        staffCount: calculations.length,
        aggregateInputHash: canonicalPayrollHash(calculations.map((item) => item.inputHash)),
      },
      metadata,
    });
  }, PAYROLL_CALCULATION_TRANSACTION_OPTIONS);
  return getPayrollPeriod(actor, periodId);
}

export async function savePayrollWorksheet(
  actor: ActorContext,
  periodId: string,
  input: PayrollWorksheetSaveInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  const targetId = await prisma.$transaction(async (tx) => {
    let period = await loadPeriodForActor(tx, actor, periodId, true);
    const createdRevision = period.status === "LOCKED" || period.status === "PUBLISHED";
    if (createdRevision) {
      const revisionId = await createRevisionInTransaction(
        tx,
        actor,
        period,
        { reason: `Sửa bảng lương sau khi đã gửi: ${input.reason}` },
        metadata,
      );
      period = await loadPeriodForActor(tx, actor, revisionId, true);
    } else if (period.version !== input.periodVersion) {
      throw new DomainError("CONFLICT", "Kỳ lương đã được cập nhật. Hãy tải lại.");
    }

    const month = period.month.toISOString().slice(0, 7);
    const bounds = periodBounds(month);
    if (input.standardDaysOffOverride !== null) {
      standardPayableDays(month, input.standardDaysOffOverride);
    }
    const assignment = await tx.branchAssignment.findFirst({
      where: {
        companyId: actor.companyId,
        branchId: period.branchId,
        staffId: input.staffId,
        effectiveFrom: { lt: parseBusinessDate(bounds.toExclusive) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseBusinessDate(bounds.from) } }],
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new DomainError("NOT_FOUND", "Nhân viên không thuộc cơ sở trong kỳ lương.");
    }
    for (const day of input.values.days) {
      if (day.businessDate < bounds.from || day.businessDate >= bounds.toExclusive) {
        throw new DomainError("VALIDATION_ERROR", "Giá trị điều chỉnh nằm ngoài kỳ lương.");
      }
    }
    let hasAutomaticPreviousData = false;
    if (typeof input.values.previousMonthCoins === "string") {
      const previousBounds = periodBounds(previousBusinessMonth(month));
      const [publishedPrevious, attendancePrevious] = await Promise.all([
        tx.payrollEntry.count({
          where: {
            companyId: actor.companyId,
            staffId: input.staffId,
            included: true,
            currentSnapshotId: { not: null },
            payrollPeriod: {
              companyId: actor.companyId,
              month: previousBounds.monthDate,
              status: "PUBLISHED",
            },
          },
        }),
        tx.attendanceDay.count({
          where: {
            companyId: actor.companyId,
            staffId: input.staffId,
            archivedAt: null,
            businessDate: {
              gte: parseBusinessDate(previousBounds.from),
              lt: parseBusinessDate(previousBounds.toExclusive),
            },
          },
        }),
      ]);
      hasAutomaticPreviousData = publishedPrevious > 0 || attendancePrevious > 0;
    }

    const existing = await tx.payrollWorksheetOverride.findUnique({
      where: {
        payrollPeriodId_staffId: {
          payrollPeriodId: period.id,
          staffId: input.staffId,
        },
      },
      select: { id: true, version: true, values: true },
    });
    if (hasAutomaticPreviousData && typeof input.values.previousMonthCoins === "string") {
      const previousStored = existing
        ? payrollWorksheetValuesSchema.parse(existing.values).previousMonthCoins
        : undefined;
      if (previousStored !== input.values.previousMonthCoins) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Tháng trước đã có dữ liệu tự động; không được nhập tổng xu thủ công.",
        );
      }
    }
    if (!createdRevision) {
      if (
        (existing === null && input.overrideVersion !== null) ||
        (existing !== null && input.overrideVersion !== existing.version)
      ) {
        throw new DomainError("CONFLICT", "Phiếu lương đã được người khác cập nhật. Hãy tải lại.");
      }
    }
    const values = payrollWorksheetValuesSchema.parse(input.values);
    let overrideId: string;
    if (existing) {
      const updated = await tx.payrollWorksheetOverride.updateMany({
        where: {
          id: existing.id,
          companyId: actor.companyId,
          version: existing.version,
        },
        data: {
          values: values as Prisma.InputJsonValue,
          updatedByUserId: actor.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError("CONFLICT", "Phiếu lương đã được người khác cập nhật. Hãy tải lại.");
      }
      overrideId = existing.id;
    } else {
      const created = await tx.payrollWorksheetOverride.create({
        data: {
          companyId: actor.companyId,
          branchId: period.branchId,
          payrollPeriodId: period.id,
          staffId: input.staffId,
          values: values as Prisma.InputJsonValue,
          updatedByUserId: actor.userId,
        },
        select: { id: true },
      });
      overrideId = created.id;
    }
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        standardDaysOffOverride: input.standardDaysOffOverride,
        status: "DRAFT",
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_WORKSHEET_SAVE",
      entityType: "PayrollWorksheetOverride",
      entityId: overrideId,
      reason: input.reason,
      before: existing
        ? {
            payrollPeriodId: period.id,
            branchId: period.branchId,
            staffId: input.staffId,
            values: existing.values,
            version: existing.version,
          }
        : undefined,
      after: {
        payrollPeriodId: period.id,
        branchId: period.branchId,
        staffId: input.staffId,
        values,
        standardDaysOffOverride: input.standardDaysOffOverride,
      },
      metadata,
    });
    return period.id;
  });

  const target = await getPayrollPeriod(actor, targetId);
  try {
    return await calculatePayrollPeriod(
      actor,
      targetId,
      { version: target.version, reason: input.reason },
      metadata,
    );
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.code === "VALIDATION_ERROR" &&
      /SALARY_RULES|salary rule/i.test(error.message)
    ) {
      return getPayrollPeriod(actor, targetId);
    }
    throw error;
  }
}

export async function sendPayrollPeriod(
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  await prisma.$transaction(async (tx) => {
    const period = await loadPeriodForActor(tx, actor, periodId, true);
    if (period.version !== input.version) {
      throw new DomainError("CONFLICT", "Kỳ lương đã được cập nhật. Hãy tải lại.");
    }
    if (period.status === "LOCKED" || period.status === "PUBLISHED") {
      throw new DomainError("CONFLICT", "Kỳ lương này đã được gửi.");
    }
    const includedEntries = await tx.payrollEntry.count({
      where: {
        companyId: actor.companyId,
        payrollPeriodId: period.id,
        included: true,
        currentSnapshotId: { not: null },
      },
    });
    if (includedEntries === 0) {
      throw new DomainError("VALIDATION_ERROR", "Kỳ lương chưa có kết quả để gửi.");
    }
    const now = new Date();
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        status: "PUBLISHED",
        publishedByUserId: actor.userId,
        publishedAt: now,
        publishReason: input.reason,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_SEND",
      entityType: "PayrollPeriod",
      entityId: period.id,
      reason: input.reason,
      before: { status: period.status, version: period.version },
      after: { status: "PUBLISHED", version: period.version + 1, includedEntries },
      metadata,
    });
  });
  return getPayrollPeriod(actor, periodId);
}

async function transitionPayroll(
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
  transition: "REVIEW" | "LOCK" | "PUBLISH",
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  await enforceSensitiveMutationRateLimit(actor, `payroll.${transition.toLowerCase()}`, {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  await prisma.$transaction(async (tx) => {
    const period = await loadPeriodForActor(tx, actor, periodId, true);
    const expected =
      transition === "REVIEW" ? "CALCULATED" : transition === "LOCK" ? "REVIEWED" : "LOCKED";
    const target =
      transition === "REVIEW" ? "REVIEWED" : transition === "LOCK" ? "LOCKED" : "PUBLISHED";
    if (period.status !== expected || period.version !== input.version) {
      throw new DomainError("CONFLICT", `Kỳ lương phải ở trạng thái ${expected} và đúng version.`);
    }
    const now = new Date();
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data:
        transition === "REVIEW"
          ? {
              status: target,
              reviewedByUserId: actor.userId,
              reviewedAt: now,
              reviewReason: input.reason,
              version: { increment: 1 },
            }
          : transition === "LOCK"
            ? {
                status: target,
                lockedByUserId: actor.userId,
                lockedAt: now,
                lockReason: input.reason,
                version: { increment: 1 },
              }
            : {
                status: target,
                publishedByUserId: actor.userId,
                publishedAt: now,
                publishReason: input.reason,
                version: { increment: 1 },
              },
    });
    await appendAudit(tx, {
      actor,
      action: `PAYROLL_${transition}`,
      entityType: "PayrollPeriod",
      entityId: period.id,
      reason: input.reason,
      before: { status: period.status, version: period.version },
      after: { status: target, version: period.version + 1 },
      metadata,
    });
  });
  return getPayrollPeriod(actor, periodId);
}

export const reviewPayrollPeriod = (
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
) => transitionPayroll(actor, periodId, input, metadata, "REVIEW");

export const lockPayrollPeriod = (
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
) => transitionPayroll(actor, periodId, input, metadata, "LOCK");

export const publishPayrollPeriod = (
  actor: ActorContext,
  periodId: string,
  input: PayrollPeriodActionInput,
  metadata: RequestMetadata,
) => transitionPayroll(actor, periodId, input, metadata, "PUBLISH");

async function createRevisionInTransaction(
  tx: Transaction,
  actor: ActorContext,
  source: Awaited<ReturnType<typeof loadPeriodForActor>>,
  input: PayrollRevisionCreateInput,
  metadata: RequestMetadata,
) {
  if (!["LOCKED", "PUBLISHED"].includes(source.status)) {
    throw new DomainError("CONFLICT", "Chỉ kỳ đã khóa/publish mới được tạo revision.");
  }
  const revisionLockKey = `payroll-revision:${actor.companyId}:${source.branchId}:${source.month
    .toISOString()
    .slice(0, 7)}`;
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${revisionLockKey}, 0))
  `;
  const latest = await tx.payrollPeriod.findFirst({
    where: {
      companyId: actor.companyId,
      branchId: source.branchId,
      month: source.month,
    },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, status: true },
  });
  if (latest && latest.id !== source.id) {
    throw new DomainError(
      "CONFLICT",
      "Kỳ lương đã có bản làm việc mới. Hãy tải lại trước khi sửa tiếp.",
    );
  }
  const created = await tx.payrollPeriod.create({
    data: {
      companyId: actor.companyId,
      branchId: source.branchId,
      month: source.month,
      revision: (latest?.revision ?? source.revision) + 1,
      sourcePeriodId: source.id,
      standardDaysOffOverride: source.standardDaysOffOverride,
      createdByUserId: actor.userId,
      creationReason: input.reason,
    },
    select: { id: true, revision: true },
  });
  const [sourceAdjustments, sourceWorksheetOverrides] = await Promise.all([
    tx.payrollAdjustment.findMany({
      where: { payrollPeriodId: source.id },
      select: { staffId: true, type: true, amount: true, reason: true, sourceDocument: true },
    }),
    tx.payrollWorksheetOverride.findMany({
      where: { companyId: actor.companyId, payrollPeriodId: source.id },
      select: { staffId: true, values: true },
    }),
  ]);
  if (sourceAdjustments.length > 0) {
    await tx.payrollAdjustment.createMany({
      data: sourceAdjustments.map((adjustment) => ({
        companyId: actor.companyId,
        branchId: source.branchId,
        payrollPeriodId: created.id,
        staffId: adjustment.staffId,
        type: adjustment.type,
        amount: adjustment.amount,
        reason: `Sao chép từ revision ${source.revision}: ${adjustment.reason}`,
        sourceDocument: adjustment.sourceDocument,
        createdByUserId: actor.userId,
        approvedByUserId: actor.userId,
      })),
    });
  }
  if (sourceWorksheetOverrides.length > 0) {
    await tx.payrollWorksheetOverride.createMany({
      data: sourceWorksheetOverrides.map((worksheet) => ({
        companyId: actor.companyId,
        branchId: source.branchId,
        payrollPeriodId: created.id,
        staffId: worksheet.staffId,
        values: worksheet.values as Prisma.InputJsonValue,
        updatedByUserId: actor.userId,
      })),
    });
  }
  await appendAudit(tx, {
    actor,
    action: "PAYROLL_REVISION_CREATE",
    entityType: "PayrollPeriod",
    entityId: created.id,
    reason: input.reason,
    before: { sourcePeriodId: source.id, sourceRevision: source.revision, status: source.status },
    after: { revision: created.revision, status: "DRAFT" },
    metadata,
  });
  return created.id;
}

export async function createPayrollRevision(
  actor: ActorContext,
  periodId: string,
  input: PayrollRevisionCreateInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  const revisionId = await prisma.$transaction(async (tx) => {
    const source = await loadPeriodForActor(tx, actor, periodId, true);
    return createRevisionInTransaction(tx, actor, source, input, metadata);
  });
  return getPayrollPeriod(actor, revisionId);
}

export async function createPayrollAdjustment(
  actor: ActorContext,
  periodId: string,
  input: PayrollAdjustmentCreateInput,
  metadata: RequestMetadata,
): Promise<PayrollPeriodDto> {
  requirePayrollWrite(actor);
  const targetId = await prisma.$transaction(async (tx) => {
    let period = await loadPeriodForActor(tx, actor, periodId, true);
    if (["LOCKED", "PUBLISHED"].includes(period.status)) {
      const revisionId = await createRevisionInTransaction(
        tx,
        actor,
        period,
        { reason: `Điều chỉnh sau khóa: ${input.reason}` },
        metadata,
      );
      period = await loadPeriodForActor(tx, actor, revisionId, true);
    } else if (period.version !== input.periodVersion) {
      throw new DomainError("CONFLICT", "Kỳ lương đã được cập nhật. Hãy tải lại.");
    }
    const bounds = periodBounds(period.month.toISOString().slice(0, 7));
    const assignment = await tx.branchAssignment.findFirst({
      where: {
        companyId: actor.companyId,
        branchId: period.branchId,
        staffId: input.staffId,
        archivedAt: null,
        effectiveFrom: { lt: parseBusinessDate(bounds.toExclusive) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseBusinessDate(bounds.from) } }],
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new DomainError("NOT_FOUND", "Nhân viên không thuộc cơ sở trong kỳ.");
    }
    const adjustment = await tx.payrollAdjustment.create({
      data: {
        companyId: actor.companyId,
        branchId: period.branchId,
        payrollPeriodId: period.id,
        staffId: input.staffId,
        type: input.type,
        amount: BigInt(input.amount),
        reason: input.reason,
        sourceDocument: input.sourceDocument ?? null,
        createdByUserId: actor.userId,
        approvedByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: { status: "DRAFT", version: { increment: 1 } },
    });
    await appendAudit(tx, {
      actor,
      action: "PAYROLL_ADJUSTMENT_CREATE",
      entityType: "PayrollAdjustment",
      entityId: adjustment.id,
      reason: input.reason,
      after: {
        payrollPeriodId: period.id,
        staffId: input.staffId,
        type: input.type,
        amount: input.amount,
        approvedByUserId: actor.userId,
      },
      metadata,
    });
    return period.id;
  });
  return getPayrollPeriod(actor, targetId);
}
