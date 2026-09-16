/**
 * Records that the current user opened a household, feeding the clients
 * list's "Recently opened" view.
 *
 * Fire-and-forget by design: `keepalive` so the POST survives the navigation
 * the same click starts, and a failure is swallowed — a missing view row must
 * never stand between an advisor and the client they clicked.
 *
 * Shared by every row-level entry point into a household (the name link and
 * the CRM/Planning quick links), so "recently opened" can't depend on which
 * target the advisor happened to click.
 *
 * Named `post…`, not `record…`: `crm/households.ts` already exports a
 * server-only `recordHouseholdOpen` that writes the row directly. Two same-named
 * exports in one domain folder — one client-safe, one not — is an autoimport
 * waiting to drag `@/db` into a client bundle.
 */
export function postHouseholdOpen(householdId: string) {
  void fetch(`/api/crm/households/${householdId}/open`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}
