import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  plaidTransactions,
  portalBindings,
  portalNotifications,
  portalPushTokens,
} from "@/db/schema";
import { buildReconnectMessage, buildTransactionsMessage, type PushMessage } from "./messages";
import { sendExpoPush } from "./expo-client";

type Kind = "transactions_to_review" | "reconnect_required";
const TRANSACTIONS_WINDOW_MS = 4 * 60 * 60 * 1000;
const RECONNECT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function recentlyNotified(
  clientId: string,
  kind: Kind,
  windowMs: number,
  plaidItemId?: string,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const conds = [
    eq(portalNotifications.clientId, clientId),
    eq(portalNotifications.kind, kind),
    gt(portalNotifications.createdAt, since),
  ];
  if (plaidItemId) conds.push(eq(portalNotifications.plaidItemId, plaidItemId));
  const [row] = await db
    .select({ id: portalNotifications.id })
    .from(portalNotifications)
    .where(and(...conds))
    .limit(1);
  return !!row;
}

/**
 * The household's enabled tokens, kept only for logins that can still open it.
 *
 * A token row is not proof of access: it outlives the binding it was registered
 * under. So the send applies `getPortalClientRef`'s rule itself — an active
 * binding to this household, or, for a login `portal_bindings` has never
 * settled anything for (no active or revoked row anywhere), the legacy
 * `clients.clerk_user_id` column naming them.
 */
async function enabledTokens(clientId: string): Promise<string[]> {
  const rows = await db
    .select({
      token: portalPushTokens.expoPushToken,
      clerkUserId: portalPushTokens.clerkUserId,
      legacyClerkUserId: clients.clerkUserId,
    })
    .from(portalPushTokens)
    .innerJoin(clients, eq(clients.id, portalPushTokens.clientId))
    .where(and(eq(portalPushTokens.clientId, clientId), eq(portalPushTokens.enabled, true)));
  if (rows.length === 0) return [];

  const bindings = await db
    .select({
      clientId: portalBindings.clientId,
      clerkUserId: portalBindings.clerkUserId,
      status: portalBindings.status,
    })
    .from(portalBindings)
    .where(inArray(portalBindings.clerkUserId, rows.map((r) => r.clerkUserId)));

  return rows
    .filter((r) => {
      const settled = bindings.filter(
        (b) => b.clerkUserId === r.clerkUserId && (b.status === "active" || b.status === "revoked"),
      );
      if (settled.length === 0) return r.legacyClerkUserId === r.clerkUserId;
      return settled.some((b) => b.clientId === clientId && b.status === "active");
    })
    .map((r) => r.token);
}

async function dispatch(params: {
  clientId: string;
  kind: Kind;
  plaidItemId: string | null;
  message: PushMessage;
  tokens: string[];
}): Promise<void> {
  const { clientId, kind, plaidItemId, message, tokens } = params;
  const result = await sendExpoPush(tokens, message);
  await db.insert(portalNotifications).values({
    clientId,
    kind,
    plaidItemId,
    body: message.body,
    tokenCount: tokens.length,
  });
  if (result.invalidTokens.length > 0) {
    await db
      .delete(portalPushTokens)
      .where(inArray(portalPushTokens.expoPushToken, result.invalidTokens));
  }
}

export async function notifyTransactionsToReview(clientId: string): Promise<void> {
  if (await recentlyNotified(clientId, "transactions_to_review", TRANSACTIONS_WINDOW_MS)) return;
  const tokens = await enabledTokens(clientId);
  if (tokens.length === 0) return;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(and(eq(plaidTransactions.clientId, clientId), isNull(plaidTransactions.reviewedAt)));
  const count = row?.count ?? 0;
  if (count === 0) return;
  await dispatch({
    clientId,
    kind: "transactions_to_review",
    plaidItemId: null,
    message: buildTransactionsMessage(count),
    tokens,
  });
}

export async function notifyReconnectRequired(item: {
  id: string;
  clientId: string;
  institutionName: string | null;
}): Promise<void> {
  if (await recentlyNotified(item.clientId, "reconnect_required", RECONNECT_WINDOW_MS, item.id))
    return;
  const tokens = await enabledTokens(item.clientId);
  if (tokens.length === 0) return;
  await dispatch({
    clientId: item.clientId,
    kind: "reconnect_required",
    plaidItemId: item.id,
    message: buildReconnectMessage(item.institutionName, item.id),
    tokens,
  });
}
