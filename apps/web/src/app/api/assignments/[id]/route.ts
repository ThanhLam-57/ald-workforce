import { assignmentUpdateSchema, idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { updateAssignment } from "@/server/services";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, assignmentUpdateSchema);
    return json({ data: await updateAssignment(actor, id, input, getRequestMetadata(request)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
