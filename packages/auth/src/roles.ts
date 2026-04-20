import { AdminAuthError } from "./get-acting-context";
import type { ActingContext, AdminRole } from "./context";

// superadmin is a superset of all other roles.
const SUPERSET: Record<AdminRole, AdminRole[]> = {
  support: ["support"],
  operator: ["support", "operator"],
  superadmin: ["support", "operator", "superadmin"],
};

export function requireRole(
  ctx: ActingContext,
  allowed: AdminRole[],
): void {
  const effective = SUPERSET[ctx.role];
  if (!allowed.some((r) => effective.includes(r))) {
    throw new AdminAuthError(
      `Role '${ctx.role}' cannot access a resource requiring ${allowed.join(" | ")}`,
      403,
    );
  }
}
