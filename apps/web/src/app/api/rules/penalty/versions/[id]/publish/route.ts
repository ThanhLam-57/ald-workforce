import { idSchema, penaltyRulePublishSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { publishPenaltyRuleVersion } from "@/server/penalty-rule-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, penaltyRulePublishSchema);
    return json({
      data: await publishPenaltyRuleVersion(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
