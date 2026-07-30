import { idSchema, staffIdentityDocumentCompleteSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { completeStaffIdentityDocument } from "@/server/staff-identity-document-service";

type Context = { params: Promise<{ id: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const params = await context.params;
    const staffId = idSchema.parse(params.id);
    const documentId = idSchema.parse(params.documentId);
    const input = await parseJson(request, staffIdentityDocumentCompleteSchema);
    return json({
      data: await completeStaffIdentityDocument(
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
