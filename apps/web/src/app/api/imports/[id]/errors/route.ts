import { idSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { toErrorResponse } from "@/server/http";
import { exportImportErrorsCsv } from "@/server/import-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request.headers);
    const id = idSchema.parse((await context.params).id);
    const bytes = await exportImportErrorsCsv(actor, id);
    return new Response(new TextDecoder().decode(bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-errors-${id}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
