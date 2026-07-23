import { penaltyRuleSetCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { createPenaltyRuleSet, listPenaltyRuleSets } from "@/server/penalty-rule-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await listPenaltyRuleSets(actor) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, penaltyRuleSetCreateSchema);
    return json(
      {
        data: await createPenaltyRuleSet(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
