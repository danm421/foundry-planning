export interface HouseholdNameParts {
  firstName: string;
  lastName: string;
  spouseFirstName?: string | null;
  spouseLastName?: string | null;
}

export function buildHouseholdName(p: HouseholdNameParts): string {
  const firstName = p.firstName.trim();
  const lastName = p.lastName.trim();
  const spouseFirstName = p.spouseFirstName?.trim() ?? "";
  const spouseLastName = p.spouseLastName?.trim() ?? "";

  if (!spouseFirstName) {
    return `${firstName} ${lastName}`.trim();
  }
  const spouseLn = spouseLastName || lastName;
  if (spouseLn === lastName) {
    return `${firstName} & ${spouseFirstName} ${lastName}`;
  }
  return `${firstName} ${lastName} & ${spouseFirstName} ${spouseLn}`;
}

// Minimal contact shape needed to derive a household name. Matches the
// crm_household_contacts columns we read; extra fields are ignored.
export interface ContactNameParts {
  role: string;
  firstName: string;
  lastName: string;
}

/**
 * True when a contact's role feeds deriveHouseholdNameFromContacts — i.e.
 * adding, removing, or renaming it can change the household name. Only the
 * primary and spouse do; dependents and other roles never affect the name.
 * Callers use this to avoid a pointless re-sync on dependent-only edits.
 */
export function roleAffectsHouseholdName(role: string): boolean {
  return role === "primary" || role === "spouse";
}

/**
 * Derives the auto-generated household name from a set of CRM contacts.
 * The primary contact drives the name; the spouse (if any) is folded in via
 * buildHouseholdName. Dependents and other roles are ignored. Returns null
 * when there is no primary contact (name can't be derived).
 */
export function deriveHouseholdNameFromContacts(
  contacts: ReadonlyArray<ContactNameParts>,
): string | null {
  const primary = contacts.find((c) => c.role === "primary");
  if (!primary) return null;
  const spouse = contacts.find((c) => c.role === "spouse");
  return buildHouseholdName({
    firstName: primary.firstName,
    lastName: primary.lastName,
    spouseFirstName: spouse?.firstName ?? null,
    spouseLastName: spouse?.lastName ?? null,
  });
}
