import { idSchema, staffWorkScheduleCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { createStaffWorkSchedule, listStaffWorkSchedules } from "@/server/staff-onboarding-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    return json({ data: await listStaffWorkSchedules(actor, staffId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffWorkScheduleCreateSchema);
    return json(
      {
        data: await createStaffWorkSchedule(actor, staffId, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
