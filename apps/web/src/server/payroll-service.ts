import { createHash } from "node:crypto";

import {
  configuredRuleSchema,
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
  type PayrollRevisionCreateInput,
  type SalaryConfig,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  calculatePayroll,
  DomainError,
  requirePermission,
  type ActorContext,
  type PayrollCalculationInput,
  type PayrollCalculationOutput,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";

const ENGINE_VERSION = "payroll-v1";
type Transaction = Prisma.TransactionClient;

type ResolvedRule = Readonly<{
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  configuration: DailyRewardConfig | MonthlyLevelConfig | SalaryConfig;
}>;

const periodInclude = {
  branch: { select: { id: true, code: true, name: true } },
  company: { select: { employeeRevenueVisible: true } },
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
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được thao tác payroll.");
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
      sourcePeriodId: true,
    },
  });
  if (!period) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy kỳ lương trong phạm vi.");
  }
  return period;
}

function parseStoredOutput(value: Prisma.JsonValue): PayrollCalculationOutput {
  return value as unknown as PayrollCalculationOutput;
}

function parseStoredInput(value: Prisma.JsonValue): PayrollCalculationInput {
  return value as unknown as PayrollCalculationInput;
}

function withoutRevenueDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !key.toLowerCase().includes("revenue"))
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
    .map((row) => ({
      businessDate: row.businessDate,
      status: row.status,
      workUnits: row.workUnits,
      overtimeMinutes: row.overtimeMinutes,
      actualLiveMinutes: row.actualLiveMinutes,
      ...(revenueVisible ? { revenueAmount: row.revenueAmount } : {}),
      dailyRevenueBonus: (bonusByAttendance.get(row.attendanceId) ?? 0n).toString(),
      penalties: row.violations
        .reduce((total, violation) => total + BigInt(violation.amount), 0n)
        .toString(),
    }));
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
    overtimeMinutes: entry.overtimeMinutes,
    ...(revenueVisible ? { revenueAmount: entry.revenueAmount.toString() } : {}),
    actualLiveMinutes: entry.actualLiveMinutes,
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
      entryDto(entry, actor.role === "GENERAL_MANAGER" || record.company.employeeRevenueVisible),
    );
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
      ...(query.branchId && actor.role === "GENERAL_MANAGER" ? { branchId: query.branchId } : {}),
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
  return records.map((record) => periodDto(record, actor));
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

async function loadResolvedRules(
  tx: Transaction,
  companyId: string,
  bounds: ReturnType<typeof periodBounds>,
): Promise<ResolvedRule[]> {
  const records = await tx.ruleVersion.findMany({
    where: {
      companyId,
      status: { not: "DRAFT" },
      effectiveFrom: { lt: parseBusinessDate(bounds.toExclusive) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseBusinessDate(bounds.from) } }],
      ruleSet: {
        type: { in: ["DAILY_REWARD_TIERS", "MONTHLY_LEVEL_RULES", "SALARY_RULES"] },
      },
    },
    select: { id: true, effectiveFrom: true, effectiveTo: true, configuration: true },
    orderBy: [{ effectiveFrom: "asc" }, { versionNo: "asc" }],
  });
  return records.flatMap((record) => {
    if (!record.effectiveFrom) return [];
    const parsed = configuredRuleSchema.safeParse(record.configuration);
    return parsed.success &&
      (parsed.data.kind === "DAILY_REWARD_TIERS" ||
        parsed.data.kind === "MONTHLY_LEVEL_RULES" ||
        parsed.data.kind === "SALARY_RULES")
      ? [{ ...record, effectiveFrom: record.effectiveFrom, configuration: parsed.data }]
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
  const matches = rulesAt(rules, kind, date);
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
      archivedAt: null,
      effectiveFrom: { lt: toDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: fromDate } }],
      staff: { archivedAt: null },
    },
    select: {
      staff: { select: { id: true } },
    },
    distinct: ["staffId"],
  });
  const staffIds = assignments.map((assignment) => assignment.staff.id).sort();
  if (staffIds.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Cơ sở không có nhân viên trong kỳ.");
  }
  const [attendance, adjustments, levels] = await Promise.all([
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
        status: true,
        workUnits: true,
        overtimeMinutes: true,
        liveMetric: { select: { actualLiveMinutes: true, revenueAmount: true } },
        violations: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            ruleVersionId: true,
            amount: true,
            itemName: true,
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
        performanceLevel: { select: { code: true, displayOrder: true } },
      },
    }),
  ]);
  const levelByStaff = new Map(levels.map((item) => [item.staffId, item.performanceLevel]));
  return staffIds.map((staffId) => {
    const input: PayrollCalculationInput = {
      staffId,
      period: {
        month,
        from: bounds.from,
        toExclusive: bounds.toExclusive,
        timezone: "Asia/Ho_Chi_Minh",
      },
      salaryRule: { ruleVersionId: salary.id, configuration: salary.configuration },
      monthlyLevelRule:
        monthly?.configuration.kind === "MONTHLY_LEVEL_RULES"
          ? {
              ruleVersionId: monthly.id,
              levels: monthly.configuration.levels,
            }
          : null,
      currentLevel: levelByStaff.get(staffId) ?? null,
      attendance: attendance
        .filter((row) => row.staffId === staffId)
        .map((row) => {
          const businessDate = row.businessDate.toISOString().slice(0, 10);
          const daily = uniqueRuleAt(rules, "DAILY_REWARD_TIERS", businessDate, false);
          return {
            attendanceId: row.id,
            businessDate,
            status: row.status,
            workUnits: row.workUnits.toString(),
            overtimeMinutes: row.overtimeMinutes,
            actualLiveMinutes: row.liveMetric?.actualLiveMinutes ?? 0,
            revenueAmount: row.liveMetric?.revenueAmount.toString() ?? "0",
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
  await prisma.$transaction(
    async (tx) => {
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
    },
    { isolationLevel: "RepeatableRead" },
  );
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
  const latest = await tx.payrollPeriod.aggregate({
    where: {
      companyId: actor.companyId,
      branchId: source.branchId,
      month: source.month,
    },
    _max: { revision: true },
  });
  const created = await tx.payrollPeriod.create({
    data: {
      companyId: actor.companyId,
      branchId: source.branchId,
      month: source.month,
      revision: (latest._max.revision ?? source.revision) + 1,
      sourcePeriodId: source.id,
      createdByUserId: actor.userId,
      creationReason: input.reason,
    },
    select: { id: true, revision: true },
  });
  const sourceAdjustments = await tx.payrollAdjustment.findMany({
    where: { payrollPeriodId: source.id },
    select: { staffId: true, type: true, amount: true, reason: true, sourceDocument: true },
  });
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
