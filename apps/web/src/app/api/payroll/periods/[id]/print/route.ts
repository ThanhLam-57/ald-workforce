import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { toErrorResponse } from "@/server/http";
import { getPayrollPrintData } from "@/server/payroll-service";
import { renderPayrollPrintHtml } from "@/server/payroll-print";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const periodId = idSchema.parse((await context.params).id);
    const requestedStaffId = new URL(request.url).searchParams.get("staffId") ?? undefined;
    const staffId = requestedStaffId ? idSchema.parse(requestedStaffId) : undefined;
    const data = await getPayrollPrintData(
      actor,
      periodId,
      staffId,
      getRequestMetadata(request),
    );
    return new Response(renderPayrollPrintHtml(data.period, data.entry), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
