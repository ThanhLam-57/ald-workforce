import { passwordChangeSchema } from "@ald/contracts";
import { prisma } from "@ald/db";
import { DomainError } from "@ald/domain";

import { auth } from "@/server/auth";
import { getOptionalActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { enforceSensitiveMutationRateLimit } from "@/server/sensitive-rate-limit";

export async function POST(request: Request) {
  try {
    const actor = await getOptionalActor(request.headers);
    if (!actor) {
      throw new DomainError("AUTHENTICATION_REQUIRED", "Vui lòng đăng nhập.");
    }
    await enforceSensitiveMutationRateLimit(actor, "account.change-password", {
      windowSeconds: 600,
      maxAttempts: 5,
    });
    const input = await parseJson(request, passwordChangeSchema);
    const metadata = getRequestMetadata(request);

    await auth.api.changePassword({
      headers: request.headers,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
    });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: actor.userId },
        data: {
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          version: { increment: 1 },
        },
      }),
      prisma.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: "account.password_change",
          entityType: "User",
          entityId: actor.userId,
          reason: actor.mustChangePassword
            ? "Hoàn tất đổi mật khẩu tạm thời"
            : "Người dùng chủ động đổi mật khẩu",
          before: { mustChangePassword: Boolean(actor.mustChangePassword) },
          after: { mustChangePassword: false, sessionsRevoked: true },
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }),
    ]);

    return json({ data: { changed: true } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
