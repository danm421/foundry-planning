// The portal savings-rule routes' account gate. A savings rule POINTS AT an
// account, so both handlers need to ask the accounts table a question the
// income and expense routes never have to ask — and they need to ask it the
// same way, or the collection route and the item route drift.
//
// It lives in `lib/` rather than being exported from `savings-rules/route.ts`
// and imported by `[id]/route.ts`: Next.js 16 type-checks route modules and a
// non-handler export from a `route.ts` fails `npm run build`. That failure
// surfaces only at the build gate — `tsc --noEmit` and vitest both pass — so it
// is worth the separate module.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import {
  isPortalVisibleAccount,
  toPortalAccountVisibility,
  type PortalAccountVisibility,
} from "./account-visibility";

/**
 * The account's portal-visibility shape, or null when it is not this client's
 * (or does not exist). Every caller goes through `toPortalAccountVisibility`
 * rather than coalescing the two optional columns itself — see that function's
 * doc comment for why that single site is what keeps the fail-closed property
 * real.
 */
export async function loadPortalAccountVisibility(
  clientId: string,
  accountId: string,
): Promise<PortalAccountVisibility | null> {
  const [row] = await db
    .select({
      category: accounts.category,
      isDefaultChecking: accounts.isDefaultChecking,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)))
    .limit(1);
  return row ? toPortalAccountVisibility(row) : null;
}

/** 400 when the account is not this client's (or does not exist) — the same
 *  answer `assertAccountsInClient` gives. 403 when it exists but the portal
 *  hides it. */
export async function assertPortalVisibleTarget(
  clientId: string,
  accountId: string | undefined,
): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
  if (!accountId) return { ok: false, status: 400, error: "accountId is required" };
  const visibility = await loadPortalAccountVisibility(clientId, accountId);
  if (!visibility) return { ok: false, status: 400, error: "Account not found for this client" };
  if (!isPortalVisibleAccount(visibility)) {
    return { ok: false, status: 403, error: "That account is managed by your advisor" };
  }
  return { ok: true };
}
