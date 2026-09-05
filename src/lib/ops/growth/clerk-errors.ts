// src/lib/ops/growth/clerk-errors.ts
//
// Isolated from load.ts on purpose: this file imports ONLY
// `@clerk/nextjs/errors` (no @/db, no Next server imports), so the one
// predicate that decides whether a per-firm Clerk failure is safe to skip
// can be unit-tested without a database. Mirrors the existing precedent for
// this exact problem: src/lib/clients/portal-invite-errors.ts.
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * True only for Clerk's 404 "no such organization" shape — the id in the
 * `firms` table doesn't correspond to a live Clerk org. This is a data
 * shape, not an incident, so the caller can skip that firm.
 *
 * Every other error — wrong status, wrong code, a non-Clerk error, auth
 * failures, rate limits — returns false so the caller still lets it
 * propagate. Do not widen this into a blanket catch.
 */
export function isMissingOrganizationError(err: unknown): boolean {
  // isClerkAPIResponseError throws on a falsy/non-object argument — guard first.
  if (!err || typeof err !== "object") return false;
  if (!isClerkAPIResponseError(err)) return false;
  if (err.status !== 404) return false;
  return err.errors.some((e) => e.code === "resource_not_found");
}
