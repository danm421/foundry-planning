import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError } from "./db-helpers";

/**
 * Forbidden — the caller is authenticated but lacks the required role.
 * 403, not 401.
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Throw if the caller is not an org:admin. Used to gate CMA mutations:
 * asset classes and model portfolios drive every client's projections,
 * so any advisor deleting them affects the whole firm. Reserving these
 * to admin roles keeps ordinary advisors from accidentally nuking
 * firm-wide capital-market assumptions.
 *
 * Treats absence of a Clerk session as 401 (UnauthorizedError);
 * authenticated-but-non-admin as 403 (ForbiddenError).
 */
export async function requireOrgAdmin(): Promise<void> {
  const { userId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgRole !== "org:admin") {
    throw new ForbiddenError("Organization admin role required");
  }
}

/**
 * Turn an auth-related thrown error into an HTTP response tuple that
 * route handlers can short-circuit with. Returns null when the error
 * isn't one of ours.
 */
export function authErrorResponse(err: unknown):
  | { status: 401 | 403; body: { error: string } }
  | null {
  if (err instanceof UnauthorizedError) return { status: 401, body: { error: "Unauthorized" } };
  if (err instanceof ForbiddenError) return { status: 403, body: { error: err.message } };
  // Legacy thrown Error("Unauthorized") instances.
  if (err instanceof Error && err.message === "Unauthorized") {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return null;
}
