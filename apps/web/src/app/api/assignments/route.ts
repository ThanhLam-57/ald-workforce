import { assignmentCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createAssignment } from "@/server/services";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, assignmentCreateSchema);
    const assignment = await createAssignment(actor, input, getRequestMetadata(request));
    return json({ data: assignment }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
