import { userCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createUserAccount } from "@/server/services";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, userCreateSchema);
    const user = await createUserAccount(actor, input, getRequestMetadata(request));
    return json({ data: user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
