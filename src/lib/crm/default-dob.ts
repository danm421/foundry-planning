// Adult household members (the client and their spouse). Dependents/children
// and "other" contacts never get an invented birthday.
const ADULT_ROLES = new Set(["primary", "spouse"]);

/**
 * Date of birth to fall back to when an adult contact is added without one:
 * January 1 of the year that makes them 50 today. A planning client can't be
 * created until its primary contact has a DOB (`POST /api/clients` returns 422
 * otherwise), so this keeps the "add a household, skip the date" flow unblocked
 * with a sensible, editable placeholder age.
 */
export function defaultAdultDateOfBirth(today: Date = new Date()): string {
  return `${today.getFullYear() - 50}-01-01`;
}

/**
 * Resolve the DOB to persist for a contact: the entered value when present,
 * otherwise the age-50 default for adult roles, otherwise undefined.
 */
export function resolveContactDateOfBirth(
  role: string,
  dateOfBirth: string | undefined,
): string | undefined {
  if (dateOfBirth) return dateOfBirth;
  return ADULT_ROLES.has(role) ? defaultAdultDateOfBirth() : undefined;
}
