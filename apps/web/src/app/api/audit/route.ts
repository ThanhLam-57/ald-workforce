import { auditListQuerySchema } from "@ald/contracts";

import { listAuditLogs } from "@/server/audit-service";
import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const query = auditListQuerySchema.parse(Object.fromEntries(url.searchParams));
    return json({ data: await listAuditLogs(actor, query, getRequestMetadata(request)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
