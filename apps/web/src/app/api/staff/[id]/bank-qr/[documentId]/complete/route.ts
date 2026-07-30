import { idSchema, staffBankQrDocumentCompleteSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { completeStaffBankQr } from "@/server/staff-bank-qr-service";

type Context = { params: Promise<{ id: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const params = await context.params;
    const staffId = idSchema.parse(params.id);
    const documentId = idSchema.parse(params.documentId);
    const input = await parseJson(request, staffBankQrDocumentCompleteSchema);
    return json({
      data: await completeStaffBankQr(
        actor,
        staffId,
        documentId,
        input,
        getRequestMetadata(request),
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
