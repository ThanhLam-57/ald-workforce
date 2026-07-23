import { managerKpiPublishSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { publishManagerKpiEvaluation } from "@/server/manager-kpi-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    const input = await parseJson(request, managerKpiPublishSchema);
    return json({
      data: await publishManagerKpiEvaluation(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
