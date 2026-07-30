import { AUTH_ROLES, DomainError, type ActorContext, type AuthRole } from "@ald/domain";
import { prisma } from "@ald/db";
import { headers } from "next/headers";

import { auth } from "./auth";
import { toBusinessDate } from "./business-date";

function parseRole(value: string): AuthRole {
  if ((AUTH_ROLES as readonly string[]).includes(value)) {
    return value as AuthRole;
  }

  throw new DomainError("FORBIDDEN", "Vai trò tài khoản không hợp lệ.");
}

export async function getOptionalActor(
  requestHeaders?: Headers,
  now = new Date(),
): Promise<ActorContext | null> {
  const session = await auth.api.getSession({
    headers: requestHeaders ?? (await headers()),
  });

  if (!session) {
    return null;
  }

  const user = session.user;
  if (!user.active || user.banned) {
    return null;
  }

  const role = parseRole(user.role ?? "LIVE_EMPLOYEE");
  const businessDate = toBusinessDate(now);
  const activeBranchIds =
    role === "TRAINING_MANAGER" && user.staffId
      ? (
          await prisma.branchAssignment.findMany({
            where: {
              companyId: user.companyId,
              staffId: user.staffId,
              assignmentType: { in: ["PRIMARY_MANAGER", "SECONDARY_MANAGER"] },
              archivedAt: null,
              effectiveFrom: { lte: businessDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
            },
            select: { branchId: true },
            distinct: ["branchId"],
          })
        ).map(({ branchId }) => branchId)
      : [];

  return {
    userId: user.id,
    companyId: user.companyId,
    staffId: user.staffId ?? null,
    role,
    activeBranchIds,
    // Legacy database flag is deliberately ignored for non-GM roles.
    canManagePayroll: role === "GENERAL_MANAGER",
    name: user.name,
    username: user.username ?? null,
    mustChangePassword: user.mustChangePassword,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

export async function requireActor(requestHeaders?: Headers): Promise<ActorContext> {
  const actor = await getOptionalActor(requestHeaders);
  if (!actor) {
    throw new DomainError("AUTHENTICATION_REQUIRED", "Vui lòng đăng nhập.");
  }
  console.info(
    JSON.stringify({
      event: "request.authorized",
      requestId: requestHeaders?.get("x-request-id") ?? null,
      userId: actor.userId,
      branchId: actor.activeBranchIds.length === 1 ? actor.activeBranchIds[0] : null,
      branchScopeCount: actor.activeBranchIds.length,
      role: actor.role,
    }),
  );

  return actor;
}
