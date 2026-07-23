import { importListQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { listImports } from "@/server/import-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const query = importListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return json({ data: await listImports(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
