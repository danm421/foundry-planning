import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";
import { CONFIG_ERROR_CODES, needsUserAction } from "./errors";
import { syncTransactionsForItem } from "./transactions-sync";
import { refreshPlaidItemData } from "./refresh-item-data";
import { recordCreate } from "@/lib/audit/record-helpers";
import type { EntitySnapshot } from "@/lib/audit/types";
import { notifyReconnectRequired, notifyTransactionsToReview } from "@/lib/portal/push/notify";

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
  lastRefreshError: string | null;
  institutionName: string | null;
};

async function findItem(payload: PlaidWebhookPayload): Promise<ItemRow | null> {
  if (!payload.item_id) return null;
  const [row] = await db
    .select({
      id: plaidItems.id,
      clientId: plaidItems.clientId,
      accessToken: plaidItems.accessToken,
      transactionsCursor: plaidItems.transactionsCursor,
      lastRefreshError: plaidItems.lastRefreshError,
      institutionName: plaidItems.institutionName,
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

async function auditSystem(
  action: "webhook.plaid.sync" | "webhook.plaid.refresh",
  item: ItemRow,
  snapshot: EntitySnapshot,
): Promise<void> {
  const [client] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, item.clientId))
    .limit(1);
  if (!client) return; // client purged between delivery and processing
  await recordCreate({
    action,
    resourceType: "plaid_item",
    resourceId: item.id,
    clientId: item.clientId,
    firmId: client.firmId,
    actorKind: "system",
    snapshot,
  });
}

const RECONNECT_CODE = "ITEM_LOGIN_REQUIRED";

/** Writes the item's error code and, only on the transition INTO
 *  ITEM_LOGIN_REQUIRED, fires the reconnect push (edge-triggered + the
 *  per-item throttle prevents redelivered webhooks from re-nudging). Push
 *  failures never propagate — they must not 500 the webhook. */
async function setItemErrorAndMaybeNotify(item: ItemRow, code: string): Promise<void> {
  const wasReconnect = item.lastRefreshError === RECONNECT_CODE;
  await db.update(plaidItems).set({ lastRefreshError: code }).where(eq(plaidItems.id, item.id));
  if (code === RECONNECT_CODE && !wasReconnect) {
    try {
      await notifyReconnectRequired({
        id: item.id,
        clientId: item.clientId,
        institutionName: item.institutionName,
      });
    } catch (e) {
      console.error("push: reconnect notify failed", e);
    }
  }
}

const ignore: Handler = async () => "ignored";

// Fresh holdings/liability data — run the same full item refresh the portal
// Refresh button uses (balances + liabilities + holdings + snapshot).
const dataRefreshHandler: Handler = async (payload) => {
  const item = await findItem(payload);
  if (!item) return "ignored";
  const result = await refreshPlaidItemData({ id: item.id, accessToken: item.accessToken });
  if (!result.ok) {
    // refreshPlaidItemData already persisted the code. User-action and
    // product-config errors are permanent — redelivery can't fix them.
    if (
      result.needsReauth ||
      needsUserAction(result.errorCode) ||
      CONFIG_ERROR_CODES.has(result.errorCode)
    ) {
      return "ok";
    }
    throw new Error(`webhook refresh failed: ${result.errorCode}`);
  }
  await auditSystem("webhook.plaid.refresh", item, {
    accountsRefreshed: result.accountsRefreshed,
    beforeTotal: result.beforeTotal,
    afterTotal: result.afterTotal,
  });
  return "ok";
};

export const plaidWebhookHandlers: Record<string, Handler> = {
  // Item entered an error state; the payload names the code.
  "ITEM:ERROR": async (payload) => {
    const code = payload.error?.error_code;
    if (!code) return "ignored";
    const item = await findItem(payload);
    if (!item) return "ignored";
    await setItemErrorAndMaybeNotify(item, code);
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
  // New transaction data is ready — run the (idempotent) incremental sync.
  "TRANSACTIONS:SYNC_UPDATES_AVAILABLE": async (payload) => {
    const item = await findItem(payload);
    if (!item) return "ignored";
    const result = await syncTransactionsForItem(item);
    if (!result.ok) {
      // Login-type and product-config failures: record status and stop —
      // redelivery can't fix them. Anything else: throw so the route 500s
      // and Plaid retries.
      if (
        needsUserAction(result.errorCode) ||
        CONFIG_ERROR_CODES.has(result.errorCode)
      ) {
        await setItemErrorAndMaybeNotify(item, result.errorCode);
        return "ok";
      }
      throw new Error(`webhook sync failed: ${result.errorCode} ${result.errorMessage}`);
    }
    await auditSystem("webhook.plaid.sync", item, {
      added: result.added,
      modified: result.modified,
      removed: result.removed,
    });
    if (result.added > 0) {
      try {
        await notifyTransactionsToReview(item.clientId);
      } catch (e) {
        console.error("push: transactions notify failed", e);
      }
    }
    return "ok";
  },
  // Legacy polling-model codes; we use /transactions/sync.
  "TRANSACTIONS:INITIAL_UPDATE": ignore,
  "TRANSACTIONS:HISTORICAL_UPDATE": ignore,
  "TRANSACTIONS:DEFAULT_UPDATE": ignore,
  // Fresh holdings/liability data — run the same full item refresh the portal
  // Refresh button uses (balances + liabilities + holdings + snapshot).
  "HOLDINGS:DEFAULT_UPDATE": dataRefreshHandler,
  "LIABILITIES:DEFAULT_UPDATE": dataRefreshHandler,
};
