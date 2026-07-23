import { companyReportExportQuerySchema } from "@ald/contracts";
import { requirePermission } from "@ald/domain";

import { requireActor } from "@/server/auth-context";
import {
  createCompanyReportPdf,
  createCompanyReportWorkbook,
  logCompanyReportExport,
} from "@/server/company-report-export";
import { getCompanyMonthlyReport } from "@/server/company-report-service";
import { toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    requirePermission(actor, "company-report:export");
    const url = new URL(request.url);
    const query = companyReportExportQuerySchema.parse({
      month: url.searchParams.get("month"),
      branchId: url.searchParams.get("branchId") || undefined,
      employmentStatus: url.searchParams.get("employmentStatus") || undefined,
      employmentCategory: url.searchParams.get("employmentCategory") || undefined,
      levelId: url.searchParams.get("levelId") || undefined,
      format: url.searchParams.get("format"),
    });
    const report = await getCompanyMonthlyReport(actor, query);
    const file =
      query.format === "xlsx"
        ? await createCompanyReportWorkbook(report)
        : await createCompanyReportPdf(report);
    await logCompanyReportExport(actor, report, query.format, getRequestMetadata(request));
    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="bao-cao-cong-ty-${report.month}.${query.format}"`,
        "Content-Type":
          query.format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
