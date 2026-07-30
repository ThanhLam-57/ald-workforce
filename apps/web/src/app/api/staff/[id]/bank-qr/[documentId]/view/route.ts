import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { viewStaffBankQr } from "@/server/staff-bank-qr-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; documentId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const params = await context.params;
    const staffId = idSchema.parse(params.id);
    const documentId = idSchema.parse(params.documentId);
    return json({
      data: await viewStaffBankQr(actor, staffId, documentId, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
