import { managerKpiCreateSchema, managerKpiListQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import {
  createManagerKpiEvaluation,
  listManagerKpiEvaluations,
} from "@/server/manager-kpi-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = managerKpiListQuerySchema.parse({
      month: url.searchParams.get("month") || undefined,
      managerStaffId: url.searchParams.get("managerStaffId") || undefined,
    });
    return json({ data: await listManagerKpiEvaluations(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, managerKpiCreateSchema);
    return json(
      { data: await createManagerKpiEvaluation(actor, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
