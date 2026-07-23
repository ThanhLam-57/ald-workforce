import { companyDashboardQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { getCompanyDashboard } from "@/server/company-dashboard-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = companyDashboardQuerySchema.parse({
      month: url.searchParams.get("month"),
      branchId: url.searchParams.get("branchId") || undefined,
    });
    return json({ data: await getCompanyDashboard(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
