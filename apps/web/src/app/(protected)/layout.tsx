import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getOptionalActor } from "@/server/auth-context";

import { navigationForRole } from "./navigation-config";
import { ProtectedShell } from "./protected-shell";

const roleLabels = {
  GENERAL_MANAGER: "Tổng quản lý",
  TRAINING_MANAGER: "Quản lý đào tạo",
  LIVE_EMPLOYEE: "Nhân viên Live",
} as const;

export default async function ProtectedLayout({ children }: Readonly<{ children: ReactNode }>) {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const scopeLabel =
    actor.role === "GENERAL_MANAGER"
      ? "Toàn công ty"
      : actor.role === "TRAINING_MANAGER"
        ? `${actor.activeBranchIds.length} cơ sở`
        : "Dữ liệu cá nhân";

  return (
    <ProtectedShell
      identity={{
        name: actor.name ?? actor.username ?? "Người dùng ALD",
        roleLabel: roleLabels[actor.role],
        scopeLabel,
      }}
      navigation={navigationForRole(actor.role)}
    >
      {children}
    </ProtectedShell>
  );
}
