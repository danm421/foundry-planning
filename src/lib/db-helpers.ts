import { auth } from "@clerk/nextjs/server";

/**
 * Thrown when the caller lacks sufficient auth context. Preferred over
 * `new Error("Unauthorized")` because it lets handlers do a tagged
 * `instanceof UnauthorizedError` check instead of brittle string
 * equality on `err.message`.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Return the caller's tenant id. Falls back to `userId` so a logged-in
 * user with no Clerk org still has a usable "firm". This mode is
 * adequate for non-PII resources but is **not** SOC-2-sufficient for
 * anything client-bearing — use `requireOrgId()` there instead.
 */
export async function getOrgId(): Promise<string> {
  const { orgId, userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  return orgId ?? userId;
}

/**
 * Strict variant of `getOrgId()`: requires a Clerk org context. Use on
 * every route that touches client PII / financial data so a
 * mis-provisioned user can't silently become their own one-person firm
 * and accidentally collide with an existing org id namespace.
 *
 * Throws `UnauthorizedError` on missing session *or* missing org.
 */
export async function requireOrgId(): Promise<string> {
  const { orgId, userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (!orgId) throw new UnauthorizedError("Organization context required");
  return orgId;
}
