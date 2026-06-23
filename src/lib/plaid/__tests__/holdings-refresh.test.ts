// src/lib/plaid/__tests__/holdings-refresh.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const investmentsHoldingsGet = vi.fn();
vi.mock("../client", () => ({ getPlaidClient: () => ({ investmentsHoldingsGet }) }));
vi.mock("../crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("../errors", () => ({
  plaidErrorCode: () => "ITEM_LOGIN_REQUIRED",
  plaidErrorMessage: () => "login required",
}));

import { fetchInvestmentHoldingsForItem } from "../holdings-refresh";

describe("fetchInvestmentHoldingsForItem", () => {
  beforeEach(() => investmentsHoldingsGet.mockReset());

  it("maps Plaid holdings + securities to IngestHolding[], filtered to linked accounts", async () => {
    investmentsHoldingsGet.mockResolvedValue({
      data: {
        holdings: [
          { account_id: "acc1", security_id: "sec1", quantity: 10, institution_price: 100, institution_price_as_of: "2026-06-20", institution_value: 1000, cost_basis: 800 },
          { account_id: "OTHER", security_id: "sec1", quantity: 5, institution_price: 100, institution_price_as_of: "2026-06-20", institution_value: 500, cost_basis: 400 },
        ],
        securities: [{ security_id: "sec1", ticker_symbol: "VTI", cusip: "922908769", name: "Vanguard Total", type: "etf" }],
      },
    });
    const res = await fetchInvestmentHoldingsForItem({ accessToken: "tok" }, ["acc1"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.holdings).toHaveLength(1);
    expect(res.holdings[0]).toMatchObject({
      plaidAccountId: "acc1", plaidSecurityId: "sec1", ticker: "VTI",
      name: "Vanguard Total", shares: "10", price: "100", priceAsOf: "2026-06-20",
      institutionValue: 1000, costBasis: "800",
    });
  });

  it("returns ok:false with errorCode on Plaid error", async () => {
    investmentsHoldingsGet.mockRejectedValueOnce(new Error("boom"));
    const res = await fetchInvestmentHoldingsForItem({ accessToken: "tok" }, ["acc1"]);
    expect(res).toEqual({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED", errorMessage: "login required" });
  });
});
