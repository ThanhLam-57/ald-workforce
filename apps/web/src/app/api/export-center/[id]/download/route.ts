import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { getDataExportDownload } from "@/server/data-export-service";
import { json, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    return json({ data: await getDataExportDownload(actor, id, getRequestMetadata(request)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
