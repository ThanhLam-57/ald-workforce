import { managerKpiSettingUpdateSchema } from "@ald/contracts";

import { requireActor } from "@/server/auth-context";
import { json, parseJson, toErrorResponse } from "@/server/http";
import { getManagerKpiSetting, updateManagerKpiSetting } from "@/server/manager-kpi-service";
import { getRequestMetadata } from "@/server/request-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: await getManagerKpiSetting(actor) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const input = await parseJson(request, managerKpiSettingUpdateSchema);
    return json({
      data: await updateManagerKpiSetting(actor, input, getRequestMetadata(request)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
