import type { ActorContext, AuthRole } from "@ald/domain";
import { redirect } from "next/navigation";

import { getOptionalActor } from "@/server/auth-context";

export async function requirePageActor(allowedRoles: readonly AuthRole[]): Promise<ActorContext> {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login");
  if (!allowedRoles.includes(actor.role)) redirect("/forbidden");
  return actor;
}
