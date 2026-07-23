import { penaltyRuleCompareQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { comparePenaltyRuleVersions } from "@/server/penalty-rule-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = penaltyRuleCompareQuerySchema.parse({
      fromVersionId: url.searchParams.get("fromVersionId"),
      toVersionId: url.searchParams.get("toVersionId"),
    });
    return json({
      data: await comparePenaltyRuleVersions(actor, query.fromVersionId, query.toVersionId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
