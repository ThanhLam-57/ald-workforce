import { activePenaltyRuleQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { listActivePenaltyVersions } from "@/server/penalty-rule-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = activePenaltyRuleQuerySchema.parse({
      date: url.searchParams.get("date"),
    });
    return json({
      data: await listActivePenaltyVersions(actor, query.date),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
