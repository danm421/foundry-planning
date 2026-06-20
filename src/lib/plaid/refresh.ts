import { getPlaidClient } from "./client";
import { decrypt } from "./crypto";

export type RefreshResult =
  | {
      ok: true;
      updates: { plaidAccountId: string; newValue: string }[];
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

type PlaidItemForRefresh = {
  accessToken: string; // encrypted blob
};

function plaidErrorCode(err: unknown): string {
  const e = err as {
    response?: { data?: { error_code?: string } };
  };
  return e.response?.data?.error_code ?? "UNKNOWN";
}

function plaidErrorMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { error_message?: string } };
    message?: string;
  };
  return e.response?.data?.error_message ?? e.message ?? "Plaid error";
}

/**
 * Fetches current balances for the given Plaid item, restricted to the
 * supplied set of `linkedPlaidAccountIds`. Returns one update per linked
 * account: investment accounts use the sum of `institution_value` from
 * holdings (positions-only); other accounts use `balances.current`.
 *
 * On Plaid error, returns `{ ok: false, errorCode, errorMessage }` —
 * the caller maps `ITEM_LOGIN_REQUIRED` / `PENDING_EXPIRATION` to the
 * re-auth UI.
 */
export async function fetchBalancesForItem(
  item: PlaidItemForRefresh,
  linkedPlaidAccountIds: string[],
): Promise<RefreshResult> {
  const client = getPlaidClient();
  const access_token = decrypt(item.accessToken);
  const linkedSet = new Set(linkedPlaidAccountIds);

  try {
    const balanceResp = await client.accountsBalanceGet({ access_token });
    const balanceAccounts = balanceResp.data.accounts.filter((a: { account_id: string }) =>
      linkedSet.has(a.account_id),
    );

    const investmentIds = balanceAccounts
      .filter((a: { type: string }) => a.type === "investment")
      .map((a: { account_id: string }) => a.account_id);

    const holdingsByAccount = new Map<string, number>();
    if (investmentIds.length > 0) {
      const holdingsResp = await client.investmentsHoldingsGet({
        access_token,
        options: { account_ids: investmentIds },
      });
      const positionSum = new Map<string, number>();
      for (const h of holdingsResp.data.holdings) {
        const prev = positionSum.get(h.account_id) ?? 0;
        positionSum.set(h.account_id, prev + (h.institution_value ?? 0));
      }
      for (const id of investmentIds) {
        holdingsByAccount.set(id, positionSum.get(id) ?? 0);
      }
    }

    const updates = balanceAccounts.map((a) => {
      const total =
        a.type === "investment"
          ? holdingsByAccount.get(a.account_id) ?? a.balances.current ?? 0
          : a.balances.current ?? 0;
      return {
        plaidAccountId: a.account_id,
        newValue: total.toFixed(2),
      };
    });

    return { ok: true, updates };
  } catch (err) {
    return {
      ok: false,
      errorCode: plaidErrorCode(err),
      errorMessage: plaidErrorMessage(err),
    };
  }
}
