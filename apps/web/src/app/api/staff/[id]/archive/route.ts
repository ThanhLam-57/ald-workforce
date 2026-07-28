import { idSchema, staffArchiveSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { archiveStaff } from "@/server/services";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffArchiveSchema);
    return json({ data: await archiveStaff(actor, id, input, getRequestMetadata(request)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
