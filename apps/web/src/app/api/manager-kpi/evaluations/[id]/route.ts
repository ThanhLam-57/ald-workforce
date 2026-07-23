import { managerKpiUpdateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { updateManagerKpiEvaluation } from "@/server/manager-kpi-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    const input = await parseJson(request, managerKpiUpdateSchema);
    return json({
      data: await updateManagerKpiEvaluation(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
