import { branchCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createBranch, listBranches } from "@/server/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await listBranches(actor) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, branchCreateSchema);
    const branch = await createBranch(actor, input, getRequestMetadata(request));
    return json({ data: branch }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
