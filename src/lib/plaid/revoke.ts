import { getPlaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/plaid/crypto";
import { redactPlaidError } from "@/lib/plaid/errors";

/**
 * Best-effort vendor-side revoke of Plaid access tokens (PII audit F3).
 *
 * Used by deletion flows where nobody is watching — firm purge (cron) and
 * single-client delete — which must complete even if Plaid 502s, so each
 * failure is swallowed and logged redacted. Contrast the portal unlink route,
 * which is fatal-on-failure because a user is waiting on the result.
 *
 * Call this with tokens collected BEFORE the DB cascade drops the plaid_items
 * rows: once the rows are gone the encrypted tokens are unrecoverable and the
 * bank connection can never be severed at Plaid.
 */
export async function revokePlaidTokens(
  encryptedTokens: string[],
  logContext: string,
): Promise<void> {
  if (!encryptedTokens.length) return;
  const plaid = getPlaidClient();
  await Promise.all(
    encryptedTokens.map(async (token) => {
      try {
        await plaid.itemRemove({ access_token: decrypt(token) });
      } catch (err) {
        console.error(`[${logContext}] plaid itemRemove failed:`, redactPlaidError(err));
      }
    }),
  );
}
