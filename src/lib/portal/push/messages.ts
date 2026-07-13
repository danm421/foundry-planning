export type PushData =
  | { kind: "transactions_to_review"; route: string }
  | { kind: "reconnect_required"; route: string; itemId: string };

export type PushMessage = { title: string; body: string; data: PushData };

/** expo-router path to the Transactions tab with the unreviewed filter on. */
export const TRANSACTIONS_ROUTE = "/(tabs)/transactions?review=1";

export function buildTransactionsMessage(count: number): PushMessage {
  const noun = count === 1 ? "transaction" : "transactions";
  return {
    title: "New transactions to review",
    body: `You have ${count} new ${noun} to review.`,
    data: { kind: "transactions_to_review", route: TRANSACTIONS_ROUTE },
  };
}

export function buildReconnectMessage(bankName: string | null, itemId: string): PushMessage {
  // Fallback is "bank" (not "your bank") — the sentence already starts "Your …".
  const bank = bankName ?? "bank";
  return {
    title: "Bank connection needs attention",
    body: `Your ${bank} connection needs attention. Tap to reconnect.`,
    data: { kind: "reconnect_required", route: `/plaid/${itemId}`, itemId },
  };
}
