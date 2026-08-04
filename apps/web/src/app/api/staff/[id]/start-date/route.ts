import { idSchema, staffStartDateCorrectionSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { correctStaffStartDate } from "@/server/staff-onboarding-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffStartDateCorrectionSchema);
    return json({
      data: await correctStaffStartDate(actor, staffId, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
