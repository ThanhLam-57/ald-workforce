import { prisma } from "@ald/db";
import { DomainError, type ActorContext } from "@ald/domain";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 10;

export async function enforceSensitiveMutationRateLimit(
  actor: ActorContext,
  action: string,
  options: { windowSeconds?: number; maxAttempts?: number } = {},
): Promise<void> {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = Date.now();
  const cutoff = now - windowSeconds * 1_000;
  const key = `app:${actor.companyId}:${actor.userId}:${action}`;

  const [result] = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "rate_limits" ("id", "key", "count", "lastRequest")
    VALUES (${crypto.randomUUID()}::uuid, ${key}, 1, ${BigInt(now)})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limits"."lastRequest" < ${BigInt(cutoff)} THEN 1
        ELSE "rate_limits"."count" + 1
      END,
      "lastRequest" = ${BigInt(now)}
    RETURNING "count"
  `;

  if (!result || result.count > maxAttempts) {
    throw new DomainError("RATE_LIMITED", "Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.", {
      retryAfterSeconds: windowSeconds,
    });
  }
}
