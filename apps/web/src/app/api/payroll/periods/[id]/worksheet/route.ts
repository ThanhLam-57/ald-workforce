import { payrollWorksheetSaveSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { savePayrollWorksheet } from "@/server/payroll-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    const input = await parseJson(request, payrollWorksheetSaveSchema);
    return json({
      data: await savePayrollWorksheet(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
