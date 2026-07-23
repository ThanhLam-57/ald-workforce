import { configuredRuleSetCreateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { createConfiguredRuleSet, listConfiguredRuleSets } from "@/server/configured-rule-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await listConfiguredRuleSets(actor) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, configuredRuleSetCreateSchema);
    return json(
      { data: await createConfiguredRuleSet(actor, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
