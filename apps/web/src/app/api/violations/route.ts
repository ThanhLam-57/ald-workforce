import { violationCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createViolation } from "@/server/violation-service";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, violationCreateSchema);
    return json(
      {
        data: await createViolation(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
