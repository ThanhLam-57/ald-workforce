import { simpleSalaryRuleApplySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { applySimpleSalaryRules } from "@/server/simple-rule-service";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, simpleSalaryRuleApplySchema);
    return json({
      data: await applySimpleSalaryRules(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
