// src/lib/plaid/holdings-refresh.ts
import { getPlaidClient } from "./client";
import { decrypt } from "./crypto";
import { plaidErrorCode, plaidErrorMessage } from "./errors";

export type IngestHolding = {
  plaidAccountId: string;
  plaidSecurityId: string;
  ticker: string | null;
  name: string | null;
  shares: string;
  price: string;
  priceAsOf: string | null;
  institutionValue: number;
  costBasis: string;
};

export type HoldingsFetchResult =
  | { ok: true; holdings: IngestHolding[] }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Fetches positions for the given Plaid item, restricted to `linkedPlaidAccountIds`.
 * Joins each holding to its security (ticker/name) and returns rows ready for
 * `ingestHoldingsForItem`. Mirrors fetchBalancesForItem's error contract.
 */
export async function fetchInvestmentHoldingsForItem(
  item: { accessToken: string },
  linkedPlaidAccountIds: string[],
): Promise<HoldingsFetchResult> {
  const linkedSet = new Set(linkedPlaidAccountIds);
  try {
    const client = getPlaidClient();
    const access_token = decrypt(item.accessToken);
    const resp = await client.investmentsHoldingsGet({ access_token });
    const secById = new Map<string, { ticker_symbol?: string | null; name?: string | null }>();
    for (const s of resp.data.securities ?? []) secById.set(s.security_id, s);

    const holdings: IngestHolding[] = [];
    for (const h of resp.data.holdings ?? []) {
      if (!linkedSet.has(h.account_id)) continue;
      const sec = secById.get(h.security_id);
      holdings.push({
        plaidAccountId: h.account_id,
        plaidSecurityId: h.security_id,
        ticker: sec?.ticker_symbol?.trim() || null,
        name: sec?.name ?? null,
        shares: String(h.quantity ?? 0),
        price: String(h.institution_price ?? 0),
        priceAsOf: h.institution_price_as_of ?? null,
        institutionValue: h.institution_value ?? 0,
        costBasis: (h.cost_basis ?? 0).toString(),
      });
    }
    return { ok: true, holdings };
  } catch (err) {
    return { ok: false, errorCode: plaidErrorCode(err), errorMessage: plaidErrorMessage(err) };
  }
}
