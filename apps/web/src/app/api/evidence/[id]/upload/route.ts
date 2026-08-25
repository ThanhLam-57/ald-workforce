import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { uploadEvidenceObject } from "@/server/violation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    return json({
      data: await uploadEvidenceObject(actor, id, request, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
