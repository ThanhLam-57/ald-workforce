import { idSchema, staffBankQrDocumentPresignSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { presignStaffBankQr } from "@/server/staff-bank-qr-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffBankQrDocumentPresignSchema);
    return json(
      { data: await presignStaffBankQr(actor, staffId, input, getRequestMetadata(request)) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
