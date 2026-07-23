import { penaltyRuleDraftCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { createPenaltyRuleDraft } from "@/server/penalty-rule-service";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, penaltyRuleDraftCreateSchema);
    return json(
      {
        data: await createPenaltyRuleDraft(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
