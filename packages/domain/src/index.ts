export const AUTH_ROLES = ["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export type ActorContext = Readonly<{
  userId: string;
  companyId: string;
  staffId: string | null;
  role: AuthRole;
  activeBranchIds: readonly string[];
}>;

export type ResourceAction =
  | "branch:create"
  | "branch:update"
  | "staff:create"
  | "staff:update"
  | "user:create"
  | "user:update"
  | "assignment:create"
  | "assignment:update"
  | "branch:read"
  | "staff:read";

const GM_MUTATIONS = new Set<ResourceAction>([
  "branch:create",
  "branch:update",
  "staff:create",
  "staff:update",
  "user:create",
  "user:update",
  "assignment:create",
  "assignment:update",
]);

export function can(actor: ActorContext, action: ResourceAction): boolean {
  if (actor.role === "GENERAL_MANAGER") {
    return true;
  }

  if (GM_MUTATIONS.has(action)) {
    return false;
  }

  if (actor.role === "TRAINING_MANAGER") {
    return action === "branch:read" || action === "staff:read";
  }

  return false;
}

export function canAccessBranch(actor: ActorContext, branchId: string): boolean {
  return (
    actor.role === "GENERAL_MANAGER" ||
    (actor.role === "TRAINING_MANAGER" && actor.activeBranchIds.includes(branchId))
  );
}

export class DomainError extends Error {
  public constructor(
    public readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "ACCOUNT_DISABLED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requirePermission(actor: ActorContext, action: ResourceAction): void {
  if (!can(actor, action)) {
    throw new DomainError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
  }
}
