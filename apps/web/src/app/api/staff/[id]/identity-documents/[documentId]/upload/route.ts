import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { uploadStaffIdentityDocument } from "@/server/staff-identity-document-service";
import { readStaffPrivateDocumentVersion } from "@/server/staff-private-document-upload-body";

type Context = { params: Promise<{ id: string; documentId: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const params = await context.params;
    const staffId = idSchema.parse(params.id);
    const documentId = idSchema.parse(params.documentId);
    const version = readStaffPrivateDocumentVersion(request);
    return json({
      data: await uploadStaffIdentityDocument(
        actor,
        staffId,
        documentId,
        version,
        request,
        getRequestMetadata(request),
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
