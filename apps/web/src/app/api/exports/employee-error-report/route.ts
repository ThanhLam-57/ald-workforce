import { attendanceMonthQuerySchema } from "@ald/contracts";

import { createEmployeeErrorReport } from "@/server/attendance-service";
import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = attendanceMonthQuerySchema.parse({
      staffId: url.searchParams.get("staffId"),
      month: url.searchParams.get("month"),
    });
    const report = await createEmployeeErrorReport(actor, query.staffId, query.month);
    return json(
      { data: report },
      {
        headers: {
          "Content-Disposition": `attachment; filename="employee-error-report-${query.month}.json"`,
        },
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
