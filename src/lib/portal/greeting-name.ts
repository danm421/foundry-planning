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

/**
 * First names of the household's primary contact and spouse, joined for the
 * portal's welcome line — `"John & Jane"`, or `"John"` for a single-person
 * household. Empty string when neither contact exists, which the navs render
 * as a nameless welcome rather than a dangling comma.
 *
 * First names only: the desktop rail is 240px wide, and "Welcome, John &
 * Jane Cooper-Whitfield" wraps to three lines. Children and external ('other')
 * contacts are never greeted — they don't sign in.
 */
export function portalGreetingName(
  contacts: readonly PortalGreetingContact[],
): string {
  return GREETED_ROLES.map((role) => contacts.find((c) => c.role === role))
    .filter((c): c is PortalGreetingContact => c !== undefined)
    .map(greetedName)
    .filter((name) => name.length > 0)
    .join(" & ");
}
