import { requireActor } from "@/server/auth-context";
import { json, toErrorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    return json({ data: actor });
  } catch (error) {
    return toErrorResponse(error);
  }
}
