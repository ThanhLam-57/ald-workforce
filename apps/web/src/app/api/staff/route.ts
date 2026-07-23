import { staffCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createStaff, listStaff } from "@/server/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await listStaff(actor, new Date()) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, staffCreateSchema);
    const staff = await createStaff(actor, input, getRequestMetadata(request));
    return json({ data: staff }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
