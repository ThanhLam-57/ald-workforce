import { branchOverviewQuerySchema } from "@ald/contracts";
import { requirePermission } from "@ald/domain";

import { requireActor } from "@/server/auth-context";
import { createBranchOverviewWorkbook } from "@/server/branch-overview-export";
import { getBranchMonthlyOverview } from "@/server/branch-overview-service";
import { toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    requirePermission(actor, "branch-overview:export");
    const url = new URL(request.url);
    const query = branchOverviewQuerySchema.parse({
      branchId: url.searchParams.get("branchId"),
      month: url.searchParams.get("month"),
      employmentStatus: url.searchParams.get("employmentStatus") || undefined,
      employmentCategory: url.searchParams.get("employmentCategory") || undefined,
      levelId: url.searchParams.get("levelId") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    const overview = await getBranchMonthlyOverview(actor, query);
    const workbook = await createBranchOverviewWorkbook(overview);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="tong-quan-${overview.branch.code}-${overview.month}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
