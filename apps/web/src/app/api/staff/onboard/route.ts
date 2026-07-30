import { staffOnboardSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { listBranchStaff, onboardStaff } from "@/server/staff-onboarding-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "1";
    return json({ data: await listBranchStaff(actor, new Date(), includeInactive) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, staffOnboardSchema);
    return json(
      {
        data: await onboardStaff(actor, input, getRequestMetadata(request)),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
