import { randomBytes } from "node:crypto";

export function newIntakeToken(): string {
  return randomBytes(24).toString("base64url");
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export function defaultExpiry(now: Date): Date {
  return new Date(now.getTime() + THIRTY_DAYS_MS);
}

export function isExpired(
  form: { expiresAt: Date; status: string },
  now: Date,
): boolean {
  if (form.status !== "draft" && form.status !== "submitted") return true;
  return form.expiresAt.getTime() <= now.getTime();
}
