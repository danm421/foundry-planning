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

/**
 * Decides what (if anything) a household's stored name should become after a
 * contact-name change — the "smart sync" rule.
 *
 * Returns the new name only when the stored name was still tracking the
 * auto-generated pattern (storedName === the name derived from the contacts
 * *before* the edit). If the advisor manually renamed the household, the
 * stored name won't match prevName, so we return null and leave it alone.
 * Also returns null when nothing changed or either name can't be derived.
 */
export function resolveAutoHouseholdName(args: {
  storedName: string;
  prevName: string | null;
  newName: string | null;
}): string | null {
  const { storedName, prevName, newName } = args;
  if (prevName == null || newName == null) return null;
  if (storedName !== prevName) return null; // manually customized → preserve
  if (newName === storedName) return null; // nothing changed
  return newName;
}
