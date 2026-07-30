import { idSchema, staffWorkScheduleUpdateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { updateStaffWorkSchedule } from "@/server/staff-onboarding-service";

type Context = { params: Promise<{ id: string; scheduleId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const params = await context.params;
    const staffId = idSchema.parse(params.id);
    const scheduleId = idSchema.parse(params.scheduleId);
    const input = await parseJson(request, staffWorkScheduleUpdateSchema);
    return json({
      data: await updateStaffWorkSchedule(
        actor,
        staffId,
        scheduleId,
        input,
        getRequestMetadata(request),
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
