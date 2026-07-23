import { payrollPeriodCreateSchema, payrollPeriodListQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { createPayrollPeriod, listPayrollPeriods } from "@/server/payroll-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = payrollPeriodListQuerySchema.parse({
      branchId: url.searchParams.get("branchId") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
    });
    return json({ data: await listPayrollPeriods(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, payrollPeriodCreateSchema);
    return json(
      { data: await createPayrollPeriod(actor, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
