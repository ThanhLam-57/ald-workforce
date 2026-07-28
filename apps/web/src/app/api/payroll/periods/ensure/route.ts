import { payrollPeriodEnsureSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { ensurePayrollPeriod } from "@/server/payroll-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, payrollPeriodEnsureSchema);
    return json({
      data: await ensurePayrollPeriod(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
