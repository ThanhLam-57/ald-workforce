import { configuredRuleDraftCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { createConfiguredRuleDraft } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, configuredRuleDraftCreateSchema);
    return json(
      { data: await createConfiguredRuleDraft(actor, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
