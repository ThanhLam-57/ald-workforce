import { evidencePresignSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { presignEvidenceUpload } from "@/server/violation-service";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, evidencePresignSchema);
    return json(
      {
        data: await presignEvidenceUpload(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
