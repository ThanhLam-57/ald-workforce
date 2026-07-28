import { simplePenaltyRuleApplySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { applySimplePenaltyRules } from "@/server/simple-rule-service";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, simplePenaltyRuleApplySchema);
    return json({
      data: await applySimplePenaltyRules(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
