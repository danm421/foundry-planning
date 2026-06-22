import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * Maps a Clerk `createInvitation` failure to an advisor-facing response.
 *
 * Clerk rejects a portal invitation when the email can't be invited:
 *  - `form_identifier_exists` (422): the email already has a Foundry account.
 *  - `duplicate_record` (400): an invitation is already pending for the email.
 *
 * Returns `null` for anything that isn't a Clerk client (4xx) error so genuine
 * 5xx / non-Clerk failures still surface as a generic 500 from the route.
 */
export function clerkInviteErrorResponse(
  err: unknown,
): { status: number; error: string } | null {
  // isClerkAPIResponseError throws on a falsy/non-object argument — guard first.
  if (!err || typeof err !== "object") return null;
  if (!isClerkAPIResponseError(err)) return null;

  const codes = err.errors.map((e) => e.code);

  if (codes.includes("form_identifier_exists")) {
    return {
      status: 409,
      error:
        "This email already has an account, so a portal invitation can't be sent to it. " +
        "Use a different email, or contact support to link the existing account.",
    };
  }

  if (codes.includes("duplicate_record")) {
    return {
      status: 409,
      error:
        "An invitation is already pending for this email. Revoke it before sending a new one.",
    };
  }

  // Any other Clerk client-side error is the advisor's to see — not a blank 500.
  if (err.status >= 400 && err.status < 500) {
    return {
      status: err.status,
      error: err.errors[0]?.message ?? "We couldn't send this invitation.",
    };
  }

  return null;
}
