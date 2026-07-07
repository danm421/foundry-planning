import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";

/**
 * Handler map for POST /api/webhooks/plaid, keyed "<webhook_type>:<webhook_code>"
 * (mirrors lib/billing/webhook-handlers.ts). Plaid sends no event id, so every
 * handler must be idempotent under redelivery: status handlers are plain
 * column writes; data handlers (Task 7) re-run idempotent syncs.
 *
 * Result semantics: "ok" = acted, "ignored" = nothing to do (also used for
 * unknown items — likely unlinked since delivery). Throw = transient failure;
 * the route 500s so Plaid retries.
 */
export type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  environment?: string;
  error?: { error_code?: string | null } | null;
};

export type PlaidWebhookHandlerResult = "ok" | "ignored";
type Handler = (payload: PlaidWebhookPayload) => Promise<PlaidWebhookHandlerResult>;

type ItemRow = {
  id: string;
  clientId: string;
  accessToken: string;
  transactionsCursor: string | null;
};

async function findItem(payload: PlaidWebhookPayload): Promise<ItemRow | null> {
  if (!payload.item_id) return null;
  const [row] = await db
    .select({
      id: plaidItems.id,
      clientId: plaidItems.clientId,
      accessToken: plaidItems.accessToken,
      transactionsCursor: plaidItems.transactionsCursor,
    })
    .from(plaidItems)
    .where(eq(plaidItems.plaidItemId, payload.item_id))
    .limit(1);
  return row ?? null;
}

/** Writes a fixed code (or clears with null) to last_refresh_error. */
function statusHandler(code: string | null): Handler {
  return async (payload) => {
    const item = await findItem(payload);
    if (!item) return "ignored";
    await db
      .update(plaidItems)
      .set({ lastRefreshError: code })
      .where(eq(plaidItems.id, item.id));
    return "ok";
  };
}

export const plaidWebhookHandlers: Record<string, Handler> = {
  // Item entered an error state; the payload names the code.
  "ITEM:ERROR": async (payload) => {
    const code = payload.error?.error_code;
    if (!code) return "ignored";
    const item = await findItem(payload);
    if (!item) return "ignored";
    await db
      .update(plaidItems)
      .set({ lastRefreshError: code })
      .where(eq(plaidItems.id, item.id));
    return "ok";
  },
  // Fired ~7 days before consent expiry / disconnection — proactive re-auth.
  "ITEM:PENDING_EXPIRATION": statusHandler("PENDING_EXPIRATION"),
  "ITEM:PENDING_DISCONNECT": statusHandler("PENDING_DISCONNECT"),
  // Item self-healed at the bank; stop nagging.
  "ITEM:LOGIN_REPAIRED": statusHandler(null),
  // Revocation is terminal — update mode can't fix it (UI offers Unlink).
  "ITEM:USER_PERMISSION_REVOKED": statusHandler("USER_PERMISSION_REVOKED"),
  "ITEM:USER_ACCOUNT_REVOKED": statusHandler("USER_ACCOUNT_REVOKED"),
  // Plaid found accounts at the bank that aren't linked yet.
  "ITEM:NEW_ACCOUNTS_AVAILABLE": async (payload) => {
    const item = await findItem(payload);
    if (!item) return "ignored";
    await db
      .update(plaidItems)
      .set({ newAccountsAvailableAt: new Date() })
      .where(eq(plaidItems.id, item.id));
    return "ok";
  },
  // Fired after itemWebhookUpdate (backfill script) — delivery confirmation.
  "ITEM:WEBHOOK_UPDATE_ACKNOWLEDGED": async () => "ignored",
};
