import { payrollExportCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { createPayrollExport, listPayrollExports } from "@/server/payroll-export-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    return json({ data: await listPayrollExports(actor, id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    const input = await parseJson(request, payrollExportCreateSchema);
    return json(
      { data: await createPayrollExport(actor, id, input, getRequestMetadata(request)) },
      { status: 202 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
