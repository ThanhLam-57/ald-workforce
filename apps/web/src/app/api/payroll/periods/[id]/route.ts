import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getPayrollPeriod } from "@/server/payroll-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const { id } = await context.params;
    return json({ data: await getPayrollPeriod(actor, id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
