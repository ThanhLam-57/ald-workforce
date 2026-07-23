import { levelProposalGenerateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { generateLevelProposals } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, levelProposalGenerateSchema);
    return json({
      data: await generateLevelProposals(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
