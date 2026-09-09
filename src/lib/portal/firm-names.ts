import "server-only";
import { resolveFirmNames } from "@/lib/activity/resolve-firm-names";
import { getFirmDisplayNames } from "@/lib/branding/db";

/** What a firm is called when neither Clerk nor the cache can name it. */
export const UNNAMED_FIRM = "A firm";

/**
 * Firm display names for the CLIENT-facing portal screens, keyed by firm id.
 *
 * Live Clerk organization name → the `firms.display_name` cache → a neutral
 * "A firm".
 *
 * NEVER "Foundry Planning", which is where `resolveFirmName` in
 * `@/lib/branding/branding` ends its own chain. That default is right on a
 * report the firm exports under our roof and wrong on these two screens — the
 * access request the client accepts, and the connected-firms list they
 * disconnect from — because both put a decision about a named party in front of
 * the client. Printing the vendor's name during a Clerk outage would take that
 * decision against a misidentified firm. A nameless firm is a better failure
 * than a wrong one: the client still knows a connection exists, and it is still
 * theirs to end.
 *
 * Shared rather than duplicated per route on purpose. Two copies of a fallback
 * chain drift, and this one already had to be fixed once after the accept
 * screen read "Foundry Planning would like to connect your account".
 *
 * `resolveFirmNames` dedupes (one firm, several households is the ordinary
 * case), resolves in parallel, and wraps EACH org in its own try/catch,
 * returning only what resolved — that absent-entry contract, shared by
 * `getFirmDisplayNames`, is what makes the per-firm fallback below possible.
 */
export async function resolvePortalFirmNames(firmIds: string[]): Promise<Map<string, string>> {
  const [live, cached] = await Promise.all([
    resolveFirmNames(firmIds),
    getFirmDisplayNames(firmIds),
  ]);
  return new Map(
    firmIds.map((id) => [id, live.get(id)?.trim() || cached.get(id)?.trim() || UNNAMED_FIRM]),
  );
}
