import { describe, expect, it, vi, beforeEach } from "vitest";

const accountsGet = vi.fn();
const investmentsHoldingsGet = vi.fn();

vi.mock("../client", () => ({
  getPlaidClient: () => ({
    accountsGet,
    investmentsHoldingsGet,
  }),
}));

vi.mock("../crypto", () => ({
  decrypt: (blob: string) => blob.replace("enc:", ""),
}));

const fakeItem = {
  id: "item-uuid",
  accessToken: "enc:access-sandbox-abc",
  plaidItemId: "plaid-item-id",
  institutionName: "Chase",
};

beforeEach(() => {
  accountsGet.mockReset();
  investmentsHoldingsGet.mockReset();
});

describe("fetchBalancesForItem", () => {
  // Balances come from /accounts/get (cached), NOT /accounts/balance/get:
  // real-time Balance is a separately-approved (and per-call billed) Plaid
  // product, and requesting it without approval fails the whole refresh with
  // INVALID_PRODUCT in production.
  it("returns per-account updates from /accounts/get for depository accounts", async () => {
    accountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: "plaid-acct-1",
            type: "depository",
            subtype: "checking",
            balances: { current: 4231.07 },
          },
        ],
      },
    });

    const { fetchBalancesForItem } = await import("../refresh");
    const result = await fetchBalancesForItem(fakeItem, ["plaid-acct-1"]);

    expect(result).toEqual({
      ok: true,
      updates: [{ plaidAccountId: "plaid-acct-1", newValue: "4231.07" }],
    });
  });

  it("sums cash + holdings for investment accounts via /investments/holdings/get", async () => {
    accountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: "plaid-acct-2",
            type: "investment",
            subtype: "401k",
            balances: { current: 1000.0 },
          },
        ],
      },
    });
    investmentsHoldingsGet.mockResolvedValue({
      data: {
        accounts: [{ account_id: "plaid-acct-2", balances: { current: 1000.0 } }],
        holdings: [
          { account_id: "plaid-acct-2", institution_value: 50_000 },
          { account_id: "plaid-acct-2", institution_value: 100_000 },
        ],
      },
    });

    const { fetchBalancesForItem } = await import("../refresh");
    const result = await fetchBalancesForItem(fakeItem, ["plaid-acct-2"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates[0].newValue).toBe("150000.00");
    }
  });

  it("returns { ok: false, errorCode } on Plaid error", async () => {
    const err = Object.assign(new Error("login required"), {
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    accountsGet.mockRejectedValue(err);

    const { fetchBalancesForItem } = await import("../refresh");
    const result = await fetchBalancesForItem(fakeItem, ["plaid-acct-1"]);

    expect(result).toMatchObject({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED" });
  });

  it("skips Plaid accounts not in the supplied linked-id list", async () => {
    accountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: "linked-1",
            type: "depository",
            subtype: "checking",
            balances: { current: 100 },
          },
          {
            account_id: "skipped-1",
            type: "depository",
            subtype: "checking",
            balances: { current: 999 },
          },
        ],
      },
    });

    const { fetchBalancesForItem } = await import("../refresh");
    const result = await fetchBalancesForItem(fakeItem, ["linked-1"]);

    expect(result).toEqual({
      ok: true,
      updates: [{ plaidAccountId: "linked-1", newValue: "100.00" }],
    });
  });
});
