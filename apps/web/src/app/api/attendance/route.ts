import { attendanceCreateSchema, attendanceMonthQuerySchema } from "@ald/contracts";

import { createAttendance, getAttendanceMonth } from "@/server/attendance-service";
import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = attendanceMonthQuerySchema.parse({
      staffId: url.searchParams.get("staffId"),
      month: url.searchParams.get("month"),
    });
    return json({
      data: await getAttendanceMonth(actor, query.staffId, query.month),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, attendanceCreateSchema);
    const attendance = await createAttendance(actor, input, getRequestMetadata(request));
    return json({ data: attendance }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
