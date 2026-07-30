import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { previewAttendanceMachineImport } from "@/server/attendance-machine-import-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    return json({
      data: await previewAttendanceMachineImport(actor, id, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
