import type { ViolationDto } from "@ald/contracts";

export type ViolationBadge = Pick<
  ViolationDto,
  "id" | "status" | "origin" | "itemName" | "displayColor"
>;

export function activeViolationBadges(
  violations: readonly ViolationBadge[],
): readonly ViolationBadge[] {
  return violations.filter((violation) => violation.status === "ACTIVE");
}
