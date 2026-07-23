import { idSchema, penaltyRuleRetireSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { retireConfiguredRuleVersion } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, penaltyRuleRetireSchema);
    return json({
      data: await retireConfiguredRuleVersion(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
