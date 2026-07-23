import { ruleImpactPreviewSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { previewConfiguredRuleImpact } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, ruleImpactPreviewSchema);
    return json({ data: await previewConfiguredRuleImpact(actor, input) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
