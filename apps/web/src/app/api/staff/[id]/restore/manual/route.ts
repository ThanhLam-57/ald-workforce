import {
  idSchema,
  staffManualRestorePreviewQuerySchema,
  staffManualRestoreSchema,
} from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import {
  previewManualStaffRestore,
  restoreStaffManually,
} from "@/server/staff-manual-restore-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const url = new URL(request.url);
    const input = staffManualRestorePreviewQuerySchema.parse({
      version: url.searchParams.get("version"),
    });
    return json({ data: await previewManualStaffRestore(actor, id, input) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffManualRestoreSchema);
    return json({
      data: await restoreStaffManually(actor, id, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
