/**
 * How a submitted intake answer reads to a person — the labels and primitives
 * shared by every surface that prints one: the CRM note apply files
 * (`note-body.ts`) and the downloadable answers PDF (`answers-document.ts`).
 * One home, so the two can't describe the same answer two different ways.
 *
 * Pure — no DB, no clock.
 */

import type { IntakePayload } from "@/lib/intake/schema";
import { individualOwnerLabel } from "@/lib/owner-labels";

// ── Wording ──────────────────────────────────────────────────────────────────
//
// Keyed by the schema's own unions so adding a member is a type error until it
// is given wording, matching the pattern in `goal-rows.ts`.

type Owner = IntakePayload["accounts"][number]["owner"];

// Account wording is NOT re-mapped here — `intakeAccountTypeLabel` owns it for
// every surface that shows an intake account (the CRM note, the review diff, the
// form's own rows), and it reads the sub-type where the client gave one
// ("Roth IRA") rather than only the coarse category ("Retirement").

export const INCOME_TYPE_LABELS: Record<IntakePayload["income"][number]["type"], string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  other: "Other",
};

export const PROPERTY_KIND_LABELS: Record<IntakePayload["property"][number]["kind"], string> = {
  real_estate: "Real estate",
  business: "Business",
};

type MaritalStatus = NonNullable<
  NonNullable<IntakePayload["family"]>["primary"]["maritalStatus"]
>;

export const MARITAL_LABELS: Record<MaritalStatus, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
};

// ── Primitives ───────────────────────────────────────────────────────────────

export function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** "1975-04-02" → "Apr 2, 1975", UTC-pinned so the day never shifts. */
export function fmtDob(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function fullName(p: { firstName?: string; lastName?: string } | undefined): string | null {
  const name = [p?.firstName?.trim(), p?.lastName?.trim()].filter(Boolean).join(" ");
  return name || null;
}

/**
 * An owner as the advisor reads it, through the shared display helper. Falls
 * back to the generic word when Family was not collected — an accounts-only
 * form has owners but no names to put to them.
 */
export function ownerLabel(owner: Owner | undefined, family: IntakePayload["family"]): string {
  return individualOwnerLabel(owner ?? "client", {
    clientName: family?.primary?.firstName?.trim() || "Client",
    spouseName: family?.spouse?.firstName?.trim() || null,
  });
}
