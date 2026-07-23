import { activeConfiguredRuleQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { listActiveConfiguredRules } from "@/server/configured-rule-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = activeConfiguredRuleQuerySchema.parse({
      date: url.searchParams.get("date"),
      type: url.searchParams.get("type") ?? undefined,
    });
    return json({
      data: await listActiveConfiguredRules(actor, query.date, query.type),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
