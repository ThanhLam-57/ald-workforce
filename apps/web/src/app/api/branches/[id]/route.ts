import { branchUpdateSchema, idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { getBranch, updateBranch } from "@/server/services";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    return json({ data: await getBranch(actor, id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, branchUpdateSchema);
    return json({ data: await updateBranch(actor, id, input, getRequestMetadata(request)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
