import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * Does this Clerk failure mean "that email already has a Foundry account"?
 *
 * Exported because the two callers must say DIFFERENT things about it. The
 * portal invite route can offer to send an access request; the intake
 * data-collection route cannot — its advisor is looking at the intake form,
 * which carries no such button — so it substitutes its own message.
 */
export function isExistingAccountError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (!isClerkAPIResponseError(err)) return false;
  return err.errors.some((e) => e.code === "form_identifier_exists");
}

/**
 * Did Clerk refuse because the email already has an invitation? Clerk says so
 * for a PENDING invitation and — forever — for an ACCEPTED one, so the caller
 * must check which before telling an advisor to revoke something.
 */
export function isDuplicateInvitationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (!isClerkAPIResponseError(err)) return false;
  return err.errors.some((e) => e.code === "duplicate_record");
}

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

  if (isExistingAccountError(err)) {
    return {
      status: 409,
      error:
        "We couldn't send an invitation to this email. Refresh and try again — " +
        "if it already has a Foundry account, the button will offer to send an access request instead.",
    };
  }

  if (isDuplicateInvitationError(err)) {
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
