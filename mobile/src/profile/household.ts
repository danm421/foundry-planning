// mobile/src/profile/household.ts
//
// Pure form-state + patch diffing for the profile screen's household
// (primary/spouse contact) section. No react, no api imports.
//
// Mirrors the API (src/app/api/portal/household/route.ts): PUT only patches
// a role that already has an existing contact row, and only the fields
// present on the patch are updated. HouseholdContactPatch's nullable fields
// (lastName/email/phone) use "" -> null ("clear it" on the wire); firstName
// is NOT NULL in the DB (crm_household_contacts.first_name) and is never
// emitted as "" or null here — a blanked firstName is simply excluded from
// the patch (the stored value stands untouched). validateFields() is the
// separate Save-gate that catches that case so the omission is never silent
// to the user: the caller blocks Save while any contact's firstName field is
// blank, rather than letting the edit vanish unremarked.
import type { HouseholdContactPatch, HouseholdUpdateInput, PortalContactDTO } from "@contracts";

/** Form state for one contact card. "" stands in for a null field. */
export type ContactFields = { firstName: string; lastName: string; email: string; phone: string };

/** Seeds form state from a fetched contact (or null if the role is empty). */
export function toFields(c: PortalContactDTO | null): ContactFields | null {
  if (!c) return null;
  return {
    firstName: c.firstName,
    lastName: c.lastName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
  };
}

/** Save-gate: false when a card's firstName is blank/whitespace-only. Every
 *  other combination of edits is fine to submit — householdPatch() itself
 *  never emits an empty firstName, but this is what stops that from
 *  happening silently. `null` (no card) always passes. */
export function validateFields(f: ContactFields | null): boolean {
  return f === null || f.firstName.trim() !== "";
}

function contactPatch(
  orig: PortalContactDTO | null,
  edited: ContactFields | null,
): HouseholdContactPatch | null {
  if (!orig || !edited) return null;

  const patch: HouseholdContactPatch = {};

  if (edited.firstName.trim() !== "" && edited.firstName !== orig.firstName) {
    patch.firstName = edited.firstName;
  }

  const origLastName = orig.lastName ?? "";
  if (edited.lastName !== origLastName) {
    patch.lastName = edited.lastName === "" ? null : edited.lastName;
  }

  const origEmail = orig.email ?? "";
  if (edited.email !== origEmail) {
    patch.email = edited.email === "" ? null : edited.email;
  }

  const origPhone = orig.phone ?? "";
  if (edited.phone !== origPhone) {
    patch.phone = edited.phone === "" ? null : edited.phone;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Diffs edited form state against the originally-fetched contacts. Returns
 *  null when nothing changed; otherwise only the roles that changed, and
 *  only the fields that changed within each role. */
export function householdPatch(
  orig: { primary: PortalContactDTO | null; spouse: PortalContactDTO | null },
  edited: { primary: ContactFields | null; spouse: ContactFields | null },
): HouseholdUpdateInput | null {
  const primary = contactPatch(orig.primary, edited.primary);
  const spouse = contactPatch(orig.spouse, edited.spouse);

  if (!primary && !spouse) return null;

  const out: HouseholdUpdateInput = {};
  if (primary) out.primary = primary;
  if (spouse) out.spouse = spouse;
  return out;
}

/** Read-only summary line for the household card, e.g. "Filing status:
 *  Married Joint · Plan horizon: through age 92". Matches the web's
 *  household-section.tsx label wording exactly (it renders the raw
 *  filingStatus value, untransformed) but degrades gracefully when either
 *  field is null: omit that clause, and return null entirely (render
 *  nothing) when both are missing. */
export function summaryLine(filingStatus: string | null, lifeExpectancy: number | null): string | null {
  const parts: string[] = [];
  if (filingStatus) parts.push(`Filing status: ${filingStatus}`);
  if (lifeExpectancy != null) parts.push(`Plan horizon: through age ${lifeExpectancy}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
