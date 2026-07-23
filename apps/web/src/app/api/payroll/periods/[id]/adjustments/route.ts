import { payrollAdjustmentCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { createPayrollAdjustment } from "@/server/payroll-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    const input = await parseJson(request, payrollAdjustmentCreateSchema);
    return json(
      { data: await createPayrollAdjustment(actor, id, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
