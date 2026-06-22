import { describe, it, expect, vi, beforeEach } from "vitest";

const liabilitiesGet = vi.fn();
vi.mock("../client", () => ({
  getPlaidClient: () => ({ liabilitiesGet }),
}));
vi.mock("../crypto", () => ({ decrypt: (s: string) => s }));

beforeEach(() => {
  vi.resetModules();
  liabilitiesGet.mockReset();
});

describe("fetchLiabilitiesForItem", () => {
  it("maps credit-card liability fields per Plaid account", async () => {
    liabilitiesGet.mockResolvedValue({
      data: {
        accounts: [{ account_id: "cc", balances: { current: 5000 } }],
        liabilities: {
          credit: [
            {
              account_id: "cc",
              last_statement_balance: 4800,
              minimum_payment_amount: 95,
              aprs: [{ apr_percentage: 22.99, apr_type: "purchase_apr" }],
              next_payment_due_date: "2026-07-15",
            },
          ],
          mortgage: [],
          student: [],
        },
      },
    });
    const { fetchLiabilitiesForItem } = await import("../liabilities-refresh");
    const res = await fetchLiabilitiesForItem({ accessToken: "enc" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.updates).toContainEqual({
      plaidAccountId: "cc",
      balance: "5000.00",
      statementBalance: "4800.00",
      minimumPayment: "95.00",
      aprPercentage: "22.9900",
      nextPaymentDueDate: "2026-07-15",
    });
  });

  it("returns ok:false with errorCode on Plaid error", async () => {
    liabilitiesGet.mockRejectedValue(
      Object.assign(new Error("login required"), {
        response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "x" } },
      }),
    );
    const { fetchLiabilitiesForItem } = await import("../liabilities-refresh");
    const res = await fetchLiabilitiesForItem({ accessToken: "enc" });
    expect(res).toMatchObject({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED" });
  });
});
