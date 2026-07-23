import { levelProposalListQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { listLevelProposals } from "@/server/configured-rule-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = levelProposalListQuerySchema.parse({ month: url.searchParams.get("month") });
    return json({ data: await listLevelProposals(actor, query.month) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
