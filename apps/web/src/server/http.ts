import { DomainError } from "@ald/domain";
import { ZodError, type ZodType } from "zod";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  return schema.parse(await request.json());
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...init.headers,
    },
  });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu không hợp lệ.",
          fields: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof DomainError) {
    const statusByCode = {
      AUTHENTICATION_REQUIRED: 401,
      ACCOUNT_DISABLED: 403,
      PASSWORD_CHANGE_REQUIRED: 403,
      RATE_LIMITED: 429,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      VALIDATION_ERROR: 400,
    } as const;

    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: statusByCode[error.code] },
    );
  }

  console.error(
    JSON.stringify({
      event: "request.unhandled_error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Hệ thống đang gặp sự cố. Vui lòng thử lại.",
      },
    },
    { status: 500 },
  );
}
