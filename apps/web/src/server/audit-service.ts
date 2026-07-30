import type { AuditListQuery, AuditLogDto } from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  diffAuditValues,
  redactSensitiveAuditValue,
  requirePermission,
  type ActorContext,
} from "@ald/domain";

import type { RequestMetadata } from "./request-metadata";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return redactSensitiveAuditValue(value) as Prisma.InputJsonValue;
}

type AuditPersistence = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Audit descriptions are derived on the server so routine mutations never
 * depend on free-text supplied by the client.
 */
export function systemAuditReason(action: string): string {
  return `SYSTEM:${action
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")}`;
}

export async function appendSecureAudit(
  input: {
    actor: ActorContext;
    action: string;
    entityType: string;
    entityId: string;
    branchId?: string | null;
    reason: string;
    before?: unknown;
    after?: unknown;
    metadata: RequestMetadata;
  },
  persistence: AuditPersistence = prisma,
): Promise<void> {
  await persistence.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      branchId: input.branchId ?? null,
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

function toDto(record: {
  id: string;
  branchId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  actor: { id: string; name: string; email: string } | null;
}): AuditLogDto {
  const before = redactSensitiveAuditValue(record.before);
  const after = redactSensitiveAuditValue(record.after);
  return {
    id: record.id,
    branchId: record.branchId,
    actor: record.actor,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    reason: record.reason,
    before,
    after,
    changes: diffAuditValues(before, after),
    requestId: record.requestId,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    occurredAt: record.occurredAt.toISOString(),
  };
}

export async function listAuditLogs(
  actor: ActorContext,
  query: AuditListQuery,
  metadata: RequestMetadata,
): Promise<Readonly<{ items: readonly AuditLogDto[]; nextCursor: string | null }>> {
  requirePermission(actor, "audit:read");
  const records = await prisma.auditLog.findMany({
    where: {
      companyId: actor.companyId,
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      branchId: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      before: true,
      after: true,
      requestId: true,
      ipAddress: true,
      userAgent: true,
      occurredAt: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = records.length > query.limit;
  const page = hasMore ? records.slice(0, query.limit) : records;
  await appendSecureAudit({
    actor,
    action: "AUDIT_LOG_READ",
    entityType: "AuditLog",
    entityId: query.cursor ?? "FIRST_PAGE",
    ...(query.branchId ? { branchId: query.branchId } : {}),
    reason: "Tra cứu lịch sử audit.",
    after: {
      filters: {
        actorUserId: query.actorUserId,
        entityType: query.entityType,
        entityId: query.entityId,
        branchId: query.branchId,
        action: query.action,
        from: query.from,
        to: query.to,
      },
      returned: page.length,
    },
    metadata,
  });
  return {
    items: page.map(toDto),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}
