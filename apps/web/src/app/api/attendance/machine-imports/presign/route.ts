import { attendanceMachineImportPresignSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { presignAttendanceMachineImportUpload } from "@/server/attendance-machine-import-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, attendanceMachineImportPresignSchema);
    return json(
      {
        data: await presignAttendanceMachineImportUpload(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
