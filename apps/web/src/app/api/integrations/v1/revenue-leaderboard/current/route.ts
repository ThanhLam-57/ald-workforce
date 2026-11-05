import { revenueLeaderboardResponseSchema } from "@ald/contracts";

import { json } from "../../../../../../server/http";
import { getRequestMetadata } from "../../../../../../server/request-metadata";
import {
  isRevenueLeaderboardAuthorized,
  readRevenueLeaderboardConfig,
} from "../../../../../../server/revenue-leaderboard-auth";
import {
  getCurrentRevenueLeaderboard,
  RevenueLeaderboardUnavailableError,
} from "../../../../../../server/revenue-leaderboard-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integrationJson(
  requestId: string,
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

function logCompletion(requestId: string, status: number, startedAt: number): void {
  console.info(
    JSON.stringify({
      event: "revenue_leaderboard.request_completed",
      requestId,
      status,
      durationMs: Date.now() - startedAt,
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const { requestId } = getRequestMetadata(request);
  const startedAt = Date.now();
  let status = 500;

  try {
    const config = readRevenueLeaderboardConfig();
    if (!config) {
      status = 503;
      return integrationJson(
        requestId,
        {
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: "Tích hợp hiện không khả dụng.",
          },
        },
        status,
      );
    }

    if (!isRevenueLeaderboardAuthorized(request.headers.get("authorization"), config.tokenSha256)) {
      status = 401;
      return integrationJson(
        requestId,
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Không được phép truy cập.",
          },
        },
        status,
      );
    }

    const url = new URL(request.url);
    if (url.searchParams.size > 0) {
      status = 400;
      return integrationJson(
        requestId,
        {
          error: {
            code: "UNSUPPORTED_QUERY",
            message: "Endpoint không hỗ trợ query parameter.",
          },
        },
        status,
      );
    }

    const data = await getCurrentRevenueLeaderboard(config.companyId);
    const response = revenueLeaderboardResponseSchema.parse({ data });
    status = 200;
    return integrationJson(requestId, response, status);
  } catch (error) {
    if (error instanceof RevenueLeaderboardUnavailableError) {
      status = 503;
      return integrationJson(
        requestId,
        {
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: "Tích hợp hiện không khả dụng.",
          },
        },
        status,
      );
    }

    status = 500;
    return integrationJson(
      requestId,
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Hệ thống đang gặp sự cố. Vui lòng thử lại.",
        },
      },
      status,
    );
  } finally {
    logCompletion(requestId, status, startedAt);
  }
}

function methodNotAllowed(request: Request): Response {
  const { requestId } = getRequestMetadata(request);
  const startedAt = Date.now();
  const status = 405;
  const response = integrationJson(
    requestId,
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Phương thức không được hỗ trợ.",
      },
    },
    status,
    { Allow: "GET" },
  );
  logCompletion(requestId, status, startedAt);
  return response;
}

export const HEAD = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
