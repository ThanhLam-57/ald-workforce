import { staffCodePreviewQuerySchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";
import { getStaffCodePreview } from "@/server/staff-onboarding-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const query = staffCodePreviewQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return json({ data: await getStaffCodePreview(actor, query) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
