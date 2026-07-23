import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getPayrollExportDownload } from "@/server/payroll-export-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    return json({
      data: await getPayrollExportDownload(actor, id, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
