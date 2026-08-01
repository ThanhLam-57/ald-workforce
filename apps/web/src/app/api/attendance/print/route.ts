import { businessMonthSchema, idSchema } from "@ald/contracts";

import { getAttendancePrintData } from "@/server/attendance-service";
import { requireActor } from "@/server/auth-context";
import { attendancePrintResponse } from "@/server/attendance-print";
import { toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const staffId = idSchema.parse(url.searchParams.get("staffId"));
    const month = businessMonthSchema.parse(url.searchParams.get("month"));
    const data = await getAttendancePrintData(actor, staffId, month, getRequestMetadata(request));
    return attendancePrintResponse(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
