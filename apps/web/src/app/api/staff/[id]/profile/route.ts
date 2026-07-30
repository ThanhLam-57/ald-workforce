import { idSchema, staffProfileUpdateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getRequestMetadata } from "@/server/request-metadata";
import { listBranchStaff, updateStaffProfile } from "@/server/staff-onboarding-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    const profile = (await listBranchStaff(actor, new Date(), true)).find(
      (staff) => staff.id === staffId,
    );
    if (!profile) {
      return json({ error: { code: "NOT_FOUND", message: "Không tìm thấy nhân viên." } }, { status: 404 });
    }
    return json({ data: profile });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireActor(request.headers);
    const staffId = idSchema.parse((await context.params).id);
    const input = await parseJson(request, staffProfileUpdateSchema);
    return json({
      data: await updateStaffProfile(actor, staffId, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
