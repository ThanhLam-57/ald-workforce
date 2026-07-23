import { businessMonthSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { listManagerKpiCandidates } from "@/server/manager-kpi-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const month = businessMonthSchema.parse(new URL(request.url).searchParams.get("month"));
    return json({ data: await listManagerKpiCandidates(actor, month) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
