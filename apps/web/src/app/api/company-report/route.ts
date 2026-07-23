import { companyReportQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { getCompanyMonthlyReport } from "@/server/company-report-service";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = companyReportQuerySchema.parse({
      month: url.searchParams.get("month"),
      branchId: url.searchParams.get("branchId") || undefined,
      employmentStatus: url.searchParams.get("employmentStatus") || undefined,
      employmentCategory: url.searchParams.get("employmentCategory") || undefined,
      levelId: url.searchParams.get("levelId") || undefined,
    });
    return json({ data: await getCompanyMonthlyReport(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
