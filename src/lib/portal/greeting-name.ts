// Who the portal chrome greets. A household is one or two people, so the
// welcome line names both when there's a spouse — "John & Jane", not just the
// primary contact. Pure (no `@/db`) so the client navs could import it too.

/**
 * The contact columns the greeting reads. Structural rather than
 * `typeof crmHouseholdContacts.$inferSelect` so a narrow `select()` satisfies
 * it. `role` is the CRM contact role enum; anything outside primary/spouse is
 * ignored.
 */
export interface PortalGreetingContact {
  role: string;
  firstName: string | null;
  lastName?: string | null;
  preferredName?: string | null;
}

/** Primary first, then spouse — the order the welcome line reads in. */
const GREETED_ROLES = ["primary", "spouse"] as const;

function greetedName(contact: PortalGreetingContact): string {
  // Preferred name wins: a greeting is exactly where "Kate" beats "Katherine".
  return (contact.preferredName ?? "").trim() || (contact.firstName ?? "").trim();
}

function greetedFullName(contact: PortalGreetingContact): string {
  return [greetedName(contact), (contact.lastName ?? "").trim()]
    .filter((part) => part.length > 0)
    .join(" ");
}

/** Primary and spouse, rendered by `name` and joined — "John & Jane". */
function greetHousehold(
  contacts: readonly PortalGreetingContact[],
  name: (contact: PortalGreetingContact) => string,
): string {
  return GREETED_ROLES.map((role) => contacts.find((c) => c.role === role))
    .filter((c): c is PortalGreetingContact => c !== undefined)
    .map(name)
    .filter((n) => n.length > 0)
    .join(" & ");
}

/**
 * First names of the household's primary contact and spouse, joined for the
 * portal's welcome line — `"John & Jane"`, or `"John"` for a single-person
 * household. Empty string when neither contact exists, which the navs render
 * as a nameless welcome rather than a dangling comma.
 *
 * First names only — this is the MOBILE top bar's greeting, which shares one
 * row with the firm mark and the account button and truncates. The desktop
 * letterhead has the width for surnames; see `portalGreetingFullName`.
 * Children and external ('other') contacts are never greeted — they don't
 * sign in.
 */
export function portalGreetingName(
  contacts: readonly PortalGreetingContact[],
): string {
  return greetHousehold(contacts, greetedName);
}

/**
 * Both halves of the household by first AND last name — `"John Cooper & Jane
 * Cooper"` — for the desktop letterhead bar, which runs the full width of the
 * window and can carry them on one line. Falls back to the first name alone
 * for a contact with no surname on file.
 */
export function portalGreetingFullName(
  contacts: readonly PortalGreetingContact[],
): string {
  return greetHousehold(contacts, greetedFullName);
}
