import { requireActor } from "@/server/auth-context";
import { listPerformanceLevelOptions } from "@/server/configured-rule-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await listPerformanceLevelOptions(actor) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
