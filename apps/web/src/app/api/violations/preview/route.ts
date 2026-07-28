import { violationPreviewQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { previewViolation } from "@/server/violation-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const searchParams = new URL(request.url).searchParams;
    const input = violationPreviewQuerySchema.parse({
      attendanceId: searchParams.get("attendanceId"),
      penaltyItemId: searchParams.get("penaltyItemId"),
    });
    return json({
      data: await previewViolation(actor, input.attendanceId, input.penaltyItemId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
