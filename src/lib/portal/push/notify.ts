import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, portalNotifications, portalPushTokens } from "@/db/schema";
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

async function enabledTokens(clientId: string): Promise<string[]> {
  const rows = await db
    .select({ token: portalPushTokens.expoPushToken })
    .from(portalPushTokens)
    .where(and(eq(portalPushTokens.clientId, clientId), eq(portalPushTokens.enabled, true)));
  return rows.map((r) => r.token);
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
