import { idSchema, penaltyRulePublishSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { publishConfiguredRuleVersion } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, penaltyRulePublishSchema);
    return json({
      data: await publishConfiguredRuleVersion(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
