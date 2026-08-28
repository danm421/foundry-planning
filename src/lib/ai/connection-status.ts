// src/lib/ai/connection-status.ts
//
// Flips a firm's own Azure connection to `error` when their credentials are
// rejected, so the Integrations card explains why AI stopped instead of the
// advisor seeing an opaque failure. Deliberately narrow: ONLY 401/403 count.
// A 429 is a quota problem and a 500 is Azure having a bad day — neither means
// the credentials are wrong, and flagging them would train firms to ignore the
// badge.
import { setConnectionStatus } from "@/lib/integrations/connections";
import { clearAiCredentialCache } from "@/lib/ai/resolve";

export function isAzureAuthFailure(err: unknown): boolean {
  // `err` is whatever a rejected promise carried — null, a string and a plain
  // object are all reachable — so the optional chain is load-bearing: reading
  // `.status` off null here would replace the AI failure with a TypeError.
  // `===` is deliberate; `==` would let a string "401" flag a firm.
  const status = (err as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

/** Best-effort. Never throws: the caller is already handling a failed AI call,
 *  and a bookkeeping error must not replace the message the advisor needs. */
export async function markAiConnectionError(firmId: string, detail: string): Promise<void> {
  try {
    await setConnectionStatus(firmId, "azure_openai", "error", detail);
    // Only once the row actually says `error`. The resolver caches firm
    // credentials for 60s per instance, so without this drop the next calls
    // keep using the just-rejected key and surface raw Azure 401s instead of
    // the `ai_firm_connection_unavailable` sentinel callers branch on — and
    // each one re-writes the status row. Clearing BEFORE the write would be
    // worse than useless: a concurrent request would re-read a row that still
    // says "connected" and put the stale entry straight back.
    clearAiCredentialCache(firmId);
  } catch {
    // swallowed by design — see above
  }
}
