import {
  kpiTemplateConfigSchema,
  type ManagerKpiCandidateDto,
  type ManagerKpiCreateInput,
  type ManagerKpiEvaluationDto,
  type ManagerKpiListQuery,
  type ManagerKpiPublishInput,
  type ManagerKpiSettingDto,
  type ManagerKpiSettingUpdateInput,
  type ManagerKpiUpdateInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  calculateKpiEvaluationScore,
  DomainError,
  enumerateBusinessMonth,
  requirePermission,
  summarizeMonthlyMetrics,
  type ActorContext,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";

type Transaction = Prisma.TransactionClient;

const evaluationInclude = {
  manager: { select: { id: true, staffCode: true, fullName: true } },
  branch: { select: { id: true, code: true, name: true } },
  templateRuleVersion: {
    select: {
      id: true,
      versionNo: true,
      ruleSet: { select: { name: true } },
    },
  },
  criteria: { orderBy: { displayOrder: "asc" as const } },
} satisfies Prisma.ManagerKpiEvaluationInclude;

type EvaluationRecord = Prisma.ManagerKpiEvaluationGetPayload<{
  include: typeof evaluationInclude;
}>;

function monthBounds(month: string) {
  const days = enumerateBusinessMonth(month);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) throw new DomainError("VALIDATION_ERROR", "Tháng không hợp lệ.");
  const start = parseBusinessDate(first.businessDate);
  const end = parseBusinessDate(last.businessDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, monthDate: start, lastDate: parseBusinessDate(last.businessDate) };
}

function requireKpiWrite(actor: ActorContext): void {
  requirePermission(actor, "manager-kpi:write");
  if (actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được chấm KPI quản lý.");
  }
}

async function appendAudit(
  tx: Transaction,
  actor: ActorContext,
  metadata: RequestMetadata,
  input: Readonly<{
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
  }>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      ...(input.before === undefined ? {} : { before: input.before as Prisma.InputJsonValue }),
      ...(input.after === undefined ? {} : { after: input.after as Prisma.InputJsonValue }),
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    },
  });
}

async function selfServiceEnabled(actor: ActorContext): Promise<void> {
  if (actor.role !== "TRAINING_MANAGER") return;
  const company = await prisma.company.findFirst({
    where: { id: actor.companyId, managerKpiSelfServiceEnabled: true },
    select: { id: true },
  });
  if (!company || !actor.staffId) {
    throw new DomainError("FORBIDDEN", "KPI self-service cho quản lý chưa được bật.");
  }
}

function candidateFromStaff(staff: {
  id: string;
  staffCode: string;
  fullName: string;
  assignments: Array<{
    assignmentType: "MEMBER" | "PRIMARY_MANAGER" | "SECONDARY_MANAGER";
    branch: { id: string; code: string; name: string };
  }>;
}): ManagerKpiCandidateDto | null {
  const assignment =
    staff.assignments.find((item) => item.assignmentType === "PRIMARY_MANAGER") ??
    staff.assignments.find((item) => item.assignmentType === "SECONDARY_MANAGER");
  return assignment
    ? {
        id: staff.id,
        staffCode: staff.staffCode,
        fullName: staff.fullName,
        branch: assignment.branch,
      }
    : null;
}

export async function listManagerKpiCandidates(
  actor: ActorContext,
  month: string,
): Promise<readonly ManagerKpiCandidateDto[]> {
  requireKpiWrite(actor);
  const bounds = monthBounds(month);
  const staff = await prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      user: { is: { role: "TRAINING_MANAGER", active: true } },
      assignments: {
        some: {
          assignmentType: { in: ["PRIMARY_MANAGER", "SECONDARY_MANAGER"] },
          archivedAt: null,
          effectiveFrom: { lt: bounds.end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.start } }],
        },
      },
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      assignments: {
        where: {
          assignmentType: { in: ["PRIMARY_MANAGER", "SECONDARY_MANAGER"] },
          archivedAt: null,
          effectiveFrom: { lt: bounds.end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.start } }],
        },
        select: {
          assignmentType: true,
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { assignmentType: "asc" },
      },
    },
    orderBy: { staffCode: "asc" },
  });
  return staff.flatMap((person) => {
    const candidate = candidateFromStaff(person);
    return candidate ? [candidate] : [];
  });
}

async function attendanceByManager(
  records: readonly EvaluationRecord[],
): Promise<
  ReadonlyMap<
    string,
    Readonly<{ workUnits: string; presentDays: number; absentDays: number; leaveDays: number }>
  >
> {
  if (records.length === 0) return new Map();
  const staffIds = [...new Set(records.map((record) => record.managerStaffId))];
  const months = records.map((record) => record.month.toISOString().slice(0, 7)).sort();
  const firstBounds = monthBounds(months[0]!);
  const lastBounds = monthBounds(months.at(-1)!);
  const attendance = await prisma.attendanceDay.findMany({
    where: {
      companyId: records[0]!.companyId,
      staffId: { in: staffIds },
      businessDate: { gte: firstBounds.start, lt: lastBounds.end },
      archivedAt: null,
    },
    select: { staffId: true, businessDate: true, status: true, workUnits: true },
  });
  const result = new Map<
    string,
    { workUnits: string; presentDays: number; absentDays: number; leaveDays: number }
  >();
  for (const evaluation of records) {
    const month = evaluation.month.toISOString().slice(0, 7);
    const values = attendance.filter(
      (item) =>
        item.staffId === evaluation.managerStaffId &&
        item.businessDate.toISOString().startsWith(month),
    );
    result.set(`${evaluation.managerStaffId}:${month}`, {
      workUnits:
        values.length === 0
          ? "0"
          : summarizeMonthlyMetrics(
              values.map((item) => ({
                revenueAmount: "0",
                workUnits: item.workUnits.toString(),
                actualLiveMinutes: 0,
                overtimeMinutes: 0,
                penaltyAmount: "0",
              })),
            ).workUnits,
      presentDays: values.filter((item) => item.status === "PRESENT").length,
      absentDays: values.filter((item) => item.status === "ABSENT").length,
      leaveDays: values.filter((item) => item.status === "LEAVE").length,
    });
  }
  return result;
}

function evaluationDto(
  record: EvaluationRecord,
  attendance: Readonly<{
    workUnits: string;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
  }>,
): ManagerKpiEvaluationDto {
  return {
    id: record.id,
    month: record.month.toISOString().slice(0, 7),
    status: record.status,
    version: record.version,
    totalScore: record.totalScore.toString(),
    maximumScore: record.maximumScore.toString(),
    notes: record.notes,
    manager: record.manager,
    branch: record.branch,
    template: {
      id: record.templateRuleVersion.id,
      ruleSetName: record.templateRuleVersion.ruleSet.name,
      versionNo: record.templateRuleVersion.versionNo,
    },
    attendance,
    criteria: record.criteria.map((line) => ({
      id: line.id,
      code: line.criterionCode,
      name: line.criterionName,
      description: line.criterionDescription,
      weightBps: line.weightBps,
      maxScore: line.maxScore,
      requiredEvidence: line.requiredEvidence,
      requiredNote: line.requiredNote,
      displayOrder: line.displayOrder,
      score: line.score.toString(),
      weightedScore: line.weightedScore.toString(),
      note: line.note,
      evidence: line.evidence,
    })),
    publishedAt: record.publishedAt?.toISOString() ?? null,
  };
}

async function dtoRecords(
  records: readonly EvaluationRecord[],
): Promise<ManagerKpiEvaluationDto[]> {
  const summaries = await attendanceByManager(records);
  return records.map((record) => {
    const key = `${record.managerStaffId}:${record.month.toISOString().slice(0, 7)}`;
    return evaluationDto(
      record,
      summaries.get(key) ?? {
        workUnits: "0",
        presentDays: 0,
        absentDays: 0,
        leaveDays: 0,
      },
    );
  });
}

export async function listManagerKpiEvaluations(
  actor: ActorContext,
  query: ManagerKpiListQuery,
): Promise<readonly ManagerKpiEvaluationDto[]> {
  requirePermission(actor, "manager-kpi:read");
  await selfServiceEnabled(actor);
  const month = query.month ? monthBounds(query.month).monthDate : undefined;
  const records = await prisma.managerKpiEvaluation.findMany({
    where: {
      companyId: actor.companyId,
      ...(month ? { month } : {}),
      ...(actor.role === "TRAINING_MANAGER"
        ? { managerStaffId: actor.staffId!, status: "PUBLISHED" }
        : query.managerStaffId
          ? { managerStaffId: query.managerStaffId }
          : {}),
    },
    include: evaluationInclude,
    orderBy: [{ month: "desc" }, { manager: { staffCode: "asc" } }],
    take: 100,
  });
  return dtoRecords(records);
}

async function getEvaluationForActor(
  actor: ActorContext,
  id: string,
): Promise<ManagerKpiEvaluationDto> {
  requirePermission(actor, "manager-kpi:read");
  await selfServiceEnabled(actor);
  const record = await prisma.managerKpiEvaluation.findFirst({
    where: {
      id,
      companyId: actor.companyId,
      ...(actor.role === "TRAINING_MANAGER"
        ? { managerStaffId: actor.staffId!, status: "PUBLISHED" }
        : {}),
    },
    include: evaluationInclude,
  });
  if (!record) throw new DomainError("NOT_FOUND", "Không tìm thấy đánh giá KPI trong phạm vi.");
  return (await dtoRecords([record]))[0]!;
}

export async function createManagerKpiEvaluation(
  actor: ActorContext,
  input: ManagerKpiCreateInput,
  metadata: RequestMetadata,
): Promise<ManagerKpiEvaluationDto> {
  requireKpiWrite(actor);
  const bounds = monthBounds(input.month);
  const candidates = await listManagerKpiCandidates(actor, input.month);
  const candidate = candidates.find((item) => item.id === input.managerStaffId);
  if (!candidate) throw new DomainError("NOT_FOUND", "Không tìm thấy quản lý trong kỳ.");
  const templates = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      ruleSet: { type: "KPI_TEMPLATE" },
      status: { not: "DRAFT" },
      effectiveFrom: { lte: bounds.lastDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.lastDate } }],
    },
    select: {
      id: true,
      configuration: true,
    },
  });
  if (templates.length !== 1) {
    throw new DomainError(
      "VALIDATION_ERROR",
      templates.length === 0
        ? "Chưa có KPI template hiệu lực ở cuối tháng."
        : "Có nhiều KPI template cùng hiệu lực; cần retire bớt trước khi chấm.",
    );
  }
  const template = templates[0]!;
  const configuration = kpiTemplateConfigSchema.safeParse(template.configuration);
  if (!configuration.success) {
    throw new DomainError("VALIDATION_ERROR", "Cấu hình KPI template không hợp lệ.");
  }
  const score = calculateKpiEvaluationScore(
    configuration.data.criteria.map((criterion) => ({
      code: criterion.code,
      weightBps: criterion.weightBps,
      maxScore: criterion.maxScore,
      score: "0",
    })),
  );
  const id = await prisma.$transaction(async (tx) => {
    const evaluation = await tx.managerKpiEvaluation.create({
      data: {
        companyId: actor.companyId,
        branchId: candidate.branch.id,
        managerStaffId: candidate.id,
        month: bounds.monthDate,
        templateRuleVersionId: template.id,
        totalScore: score.totalScore,
        maximumScore: score.maximumScore,
        notes: input.notes ?? null,
        createdByUserId: actor.userId,
        criteria: {
          create: configuration.data.criteria.map((criterion) => ({
            companyId: actor.companyId,
            criterionCode: criterion.code,
            criterionName: criterion.name,
            criterionDescription: criterion.description,
            weightBps: criterion.weightBps,
            maxScore: criterion.maxScore,
            requiredEvidence: criterion.requiredEvidence,
            requiredNote: criterion.requiredNote,
            displayOrder: criterion.displayOrder,
          })),
        },
      },
      select: { id: true },
    });
    await appendAudit(tx, actor, metadata, {
      action: "MANAGER_KPI_CREATE",
      entityType: "ManagerKpiEvaluation",
      entityId: evaluation.id,
      reason: input.reason,
      after: {
        managerStaffId: candidate.id,
        branchId: candidate.branch.id,
        month: input.month,
        templateRuleVersionId: template.id,
      },
    });
    return evaluation.id;
  });
  return getEvaluationForActor(actor, id);
}

export async function updateManagerKpiEvaluation(
  actor: ActorContext,
  id: string,
  input: ManagerKpiUpdateInput,
  metadata: RequestMetadata,
): Promise<ManagerKpiEvaluationDto> {
  requireKpiWrite(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.managerKpiEvaluation.findFirst({
      where: {
        id,
        companyId: actor.companyId,
        status: "DRAFT",
        version: input.version,
      },
      include: { criteria: true },
    });
    if (!current) {
      throw new DomainError("CONFLICT", "Đánh giá KPI đã thay đổi hoặc đã publish.");
    }
    const inputByCode = new Map(input.criteria.map((line) => [line.code, line]));
    if (
      inputByCode.size !== current.criteria.length ||
      current.criteria.some((line) => !inputByCode.has(line.criterionCode))
    ) {
      throw new DomainError("VALIDATION_ERROR", "Phải gửi đủ tiêu chí của template snapshot.");
    }
    const calculated = calculateKpiEvaluationScore(
      current.criteria.map((line) => ({
        code: line.criterionCode,
        weightBps: line.weightBps,
        maxScore: line.maxScore,
        score: inputByCode.get(line.criterionCode)!.score,
      })),
    );
    const calculatedByCode = new Map(calculated.lines.map((line) => [line.code, line]));
    for (const line of current.criteria) {
      const submitted = inputByCode.get(line.criterionCode)!;
      const result = calculatedByCode.get(line.criterionCode)!;
      await tx.managerKpiCriterionLine.update({
        where: { id: line.id },
        data: {
          score: result.score,
          weightedScore: result.weightedScore,
          note: submitted.note,
          evidence: submitted.evidence,
        },
      });
    }
    await tx.managerKpiEvaluation.update({
      where: { id: current.id },
      data: {
        totalScore: calculated.totalScore,
        maximumScore: calculated.maximumScore,
        notes: input.notes,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, actor, metadata, {
      action: "MANAGER_KPI_UPDATE",
      entityType: "ManagerKpiEvaluation",
      entityId: current.id,
      reason: input.reason,
      before: { version: current.version, totalScore: current.totalScore.toString() },
      after: { version: current.version + 1, totalScore: calculated.totalScore },
    });
  });
  return getEvaluationForActor(actor, id);
}

export async function publishManagerKpiEvaluation(
  actor: ActorContext,
  id: string,
  input: ManagerKpiPublishInput,
  metadata: RequestMetadata,
): Promise<ManagerKpiEvaluationDto> {
  requireKpiWrite(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.managerKpiEvaluation.findFirst({
      where: {
        id,
        companyId: actor.companyId,
        status: "DRAFT",
        version: input.version,
      },
      include: { criteria: true },
    });
    if (!current) {
      throw new DomainError("CONFLICT", "Đánh giá KPI đã thay đổi hoặc đã publish.");
    }
    const incomplete = current.criteria.find(
      (line) =>
        (line.requiredNote && !line.note?.trim()) ||
        (line.requiredEvidence && !line.evidence?.trim()),
    );
    if (incomplete) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Tiêu chí ${incomplete.criterionCode} chưa đủ ghi chú/minh chứng bắt buộc.`,
      );
    }
    const now = new Date();
    await tx.managerKpiEvaluation.update({
      where: { id: current.id },
      data: {
        status: "PUBLISHED",
        publishedByUserId: actor.userId,
        publishedAt: now,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, actor, metadata, {
      action: "MANAGER_KPI_PUBLISH",
      entityType: "ManagerKpiEvaluation",
      entityId: current.id,
      reason: input.reason,
      before: { status: current.status, version: current.version },
      after: { status: "PUBLISHED", version: current.version + 1 },
    });
  });
  return getEvaluationForActor(actor, id);
}

export async function getManagerKpiSetting(actor: ActorContext): Promise<ManagerKpiSettingDto> {
  requirePermission(actor, "manager-kpi:read");
  const company = await prisma.company.findFirst({
    where: { id: actor.companyId },
    select: { managerKpiSelfServiceEnabled: true, version: true },
  });
  if (!company) throw new DomainError("NOT_FOUND", "Không tìm thấy công ty.");
  return { enabled: company.managerKpiSelfServiceEnabled, version: company.version };
}

export async function updateManagerKpiSetting(
  actor: ActorContext,
  input: ManagerKpiSettingUpdateInput,
  metadata: RequestMetadata,
): Promise<ManagerKpiSettingDto> {
  requireKpiWrite(actor);
  return prisma.$transaction(async (tx) => {
    const current = await tx.company.findFirst({
      where: { id: actor.companyId, version: input.version },
      select: { managerKpiSelfServiceEnabled: true, version: true },
    });
    if (!current) throw new DomainError("CONFLICT", "Cài đặt công ty đã thay đổi.");
    const updated = await tx.company.update({
      where: { id: actor.companyId },
      data: {
        managerKpiSelfServiceEnabled: input.enabled,
        version: { increment: 1 },
      },
      select: { managerKpiSelfServiceEnabled: true, version: true },
    });
    await appendAudit(tx, actor, metadata, {
      action: "MANAGER_KPI_SELF_SERVICE_UPDATE",
      entityType: "Company",
      entityId: actor.companyId,
      reason: input.reason,
      before: { enabled: current.managerKpiSelfServiceEnabled, version: current.version },
      after: {
        enabled: updated.managerKpiSelfServiceEnabled,
        version: updated.version,
      },
    });
    return { enabled: updated.managerKpiSelfServiceEnabled, version: updated.version };
  });
}
