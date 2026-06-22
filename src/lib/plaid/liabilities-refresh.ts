import { getPlaidClient } from "./client";
import { decrypt } from "./crypto";
import { plaidErrorCode, plaidErrorMessage } from "./errors";

export type LiabilityUpdate = {
  plaidAccountId: string;
  balance: string;
  statementBalance: string | null;
  minimumPayment: string | null;
  aprPercentage: string | null;
  nextPaymentDueDate: string | null;
};

export type LiabilitiesRefreshResult =
  | { ok: true; updates: LiabilityUpdate[] }
  | { ok: false; errorCode: string; errorMessage: string };

type PlaidItemForRefresh = { accessToken: string };

const dec2 = (n: number | null | undefined): string | null =>
  n == null ? null : n.toFixed(2);

/**
 * Fetches Plaid Liabilities-product detail for an item: current balance plus
 * credit-card statement/minimum/APR/due-date. Returns one update per liability
 * account; the caller writes them to `liabilities` keyed on (plaidItemId,
 * plaidAccountId). Mirrors fetchBalancesForItem's error contract.
 */
export async function fetchLiabilitiesForItem(
  item: PlaidItemForRefresh,
): Promise<LiabilitiesRefreshResult> {
  const client = getPlaidClient();
  const access_token = decrypt(item.accessToken);
  try {
    const resp = await client.liabilitiesGet({ access_token });
    const balByAccount = new Map<string, number | null | undefined>();
    for (const a of resp.data.accounts) balByAccount.set(a.account_id, a.balances.current);

    const updates: LiabilityUpdate[] = [];
    const liab = resp.data.liabilities ?? {};
    for (const c of liab.credit ?? []) {
      const purchaseApr =
        (c.aprs ?? []).find((a) => a.apr_type === "purchase_apr") ?? (c.aprs ?? [])[0];
      updates.push({
        plaidAccountId: c.account_id!,
        balance: (balByAccount.get(c.account_id!) ?? 0).toFixed(2),
        statementBalance: dec2(c.last_statement_balance),
        minimumPayment: dec2(c.minimum_payment_amount),
        aprPercentage:
          purchaseApr?.apr_percentage != null ? purchaseApr.apr_percentage.toFixed(4) : null,
        nextPaymentDueDate: c.next_payment_due_date ?? null,
      });
    }
    for (const m of liab.mortgage ?? []) {
      updates.push({
        plaidAccountId: m.account_id!,
        balance: (balByAccount.get(m.account_id!) ?? 0).toFixed(2),
        statementBalance: null,
        minimumPayment: dec2(m.next_monthly_payment),
        aprPercentage:
          m.interest_rate?.percentage != null ? m.interest_rate.percentage.toFixed(4) : null,
        nextPaymentDueDate: m.next_payment_due_date ?? null,
      });
    }
    for (const s of liab.student ?? []) {
      updates.push({
        plaidAccountId: s.account_id!,
        balance: (balByAccount.get(s.account_id!) ?? 0).toFixed(2),
        statementBalance: null,
        minimumPayment: dec2(s.minimum_payment_amount),
        aprPercentage:
          s.interest_rate_percentage != null ? s.interest_rate_percentage.toFixed(4) : null,
        nextPaymentDueDate: s.next_payment_due_date ?? null,
      });
    }
    return { ok: true, updates };
  } catch (err) {
    return { ok: false, errorCode: plaidErrorCode(err), errorMessage: plaidErrorMessage(err) };
  }
}
