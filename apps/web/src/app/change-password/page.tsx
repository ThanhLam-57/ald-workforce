import { redirect } from "next/navigation";

import { getOptionalActor } from "@/server/auth-context";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login");
  redirect("/settings/security");
}
