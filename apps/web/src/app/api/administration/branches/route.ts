import { adminBranchListQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { listAdminBranches } from "@/server/administration-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const query = adminBranchListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return json({ data: await listAdminBranches(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
