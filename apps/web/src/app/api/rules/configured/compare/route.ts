import { configuredRuleCompareQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { compareConfiguredRuleVersions } from "@/server/configured-rule-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = configuredRuleCompareQuerySchema.parse({
      fromVersionId: url.searchParams.get("fromVersionId"),
      toVersionId: url.searchParams.get("toVersionId"),
    });
    return json({
      data: await compareConfiguredRuleVersions(actor, query.fromVersionId, query.toVersionId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
