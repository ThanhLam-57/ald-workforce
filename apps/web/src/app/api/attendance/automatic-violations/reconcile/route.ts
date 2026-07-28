import { automaticViolationReconcileSchema } from "@ald/contracts";

import { reconcileAutomaticViolationsForMonth } from "@/server/attendance-service";
import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, automaticViolationReconcileSchema);
    return json({
      data: await reconcileAutomaticViolationsForMonth(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
