import { branchOverviewBatchUpdateSchema, branchOverviewQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import {
  getBranchMonthlyOverview,
  updateBranchOverviewCells,
} from "@/server/branch-overview-service";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

function queryInput(request: Request) {
  const url = new URL(request.url);
  return branchOverviewQuerySchema.parse({
    branchId: url.searchParams.get("branchId"),
    month: url.searchParams.get("month"),
    employmentStatus: url.searchParams.get("employmentStatus") || undefined,
    employmentCategory: url.searchParams.get("employmentCategory") || undefined,
    levelId: url.searchParams.get("levelId") || undefined,
    search: url.searchParams.get("search") || undefined,
  });
}

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({
      data: await getBranchMonthlyOverview(actor, queryInput(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, branchOverviewBatchUpdateSchema);
    const results = await updateBranchOverviewCells(actor, input, getRequestMetadata(request));
    const allSaved = results.every((result) => result.status === "SAVED");
    const allConflicted = results.every((result) => result.status === "CONFLICT");
    return json(
      {
        data: results,
        ...(allConflicted
          ? {
              error: {
                code: "CONFLICT",
                message: "Dữ liệu nguồn đã được cập nhật bởi người khác.",
              },
            }
          : {}),
      },
      { status: allConflicted ? 409 : allSaved ? 200 : 207 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
