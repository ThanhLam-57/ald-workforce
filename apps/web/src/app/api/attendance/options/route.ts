import { attendanceFilterOptionsQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { getAttendanceFilterOptions } from "@/server/attendance-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = attendanceFilterOptionsQuerySchema.parse({
      month: url.searchParams.get("month"),
      branchId: url.searchParams.get("branchId") ?? undefined,
    });
    return json({
      data: await getAttendanceFilterOptions(actor, query.month, query.branchId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
