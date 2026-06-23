import { randomBytes } from "node:crypto";

export function newIntakeToken(): string {
  return randomBytes(24).toString("base64url");
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export function defaultExpiry(now: Date): Date {
  return new Date(now.getTime() + THIRTY_DAYS_MS);
}

/**
 * A form is "open" while it can still be edited or acted on — draft (being
 * filled) or submitted (awaiting advisor apply/discard). Everything else
 * (applied/discarded/expired) is terminal. Centralizes the status vocabulary
 * the lifecycle routes (discard, revoke) and expiry all reason about.
 */
export function isOpenStatus(status: string): boolean {
  return status === "draft" || status === "submitted";
}

export function isExpired(
  form: { expiresAt: Date; status: string },
  now: Date,
): boolean {
  if (!isOpenStatus(form.status)) return true;
  return form.expiresAt.getTime() <= now.getTime();
}
