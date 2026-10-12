// src/lib/clients/__tests__/living-items-writes.test.ts
//
// setLivingItemsForClient finds the base case's Current Living Expenses row —
// never the Retirement one, never an advisor-added living row — merges the list
// into it, and saves through updateExpenseForClient so the page's rules (and its
// access check) apply.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => rows() }) }) }) },
}));
vi.mock("../expenses-writes", () => ({ updateExpenseForClient: vi.fn() }));

import { setLivingItemsForClient } from "../living-items-writes";
import { updateExpenseForClient } from "../expenses-writes";

const HOUSING = { id: "i1", name: "Housing", amount: 3200, frequency: "monthly" as const };
const RETIREMENT = { id: "exp-ret", type: "living", isDefault: true, startYearRef: "client_retirement", livingItems: null };
const CURRENT = { id: "exp-cur", type: "living", isDefault: true, startYearRef: "plan_start", livingItems: [HOUSING] };
// Starts at plan start like the Current slot, but an advisor added it.
const ADDED = { ...CURRENT, id: "exp-added", isDefault: false };

const ARGS = {
  clientId: "client_1",
  firmId: "org_1",
  actorId: "u1",
  items: [{ name: "Groceries", amount: 900, frequency: "monthly" as const }],
  mode: "add" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateExpenseForClient).mockResolvedValue({ ok: true, data: {} as never, resourceId: "exp-cur" });
});

describe("setLivingItemsForClient", () => {
  it("merges the list into the Current row, not the Retirement row or an advisor-added one", async () => {
    rows.mockResolvedValue([ADDED, RETIREMENT, CURRENT]);
    await setLivingItemsForClient(ARGS);

    expect(updateExpenseForClient).toHaveBeenCalledWith({
      clientId: "client_1",
      firmId: "org_1",
      actorId: "u1",
      expenseId: "exp-cur",
      input: {
        livingItems: [HOUSING, { id: expect.any(String), name: "Groceries", amount: 900, frequency: "monthly" }],
      },
    });
  });

  it("refuses when the plan has no Current row", async () => {
    rows.mockResolvedValue([RETIREMENT]);
    const r = await setLivingItemsForClient(ARGS);
    expect(r).toEqual({ ok: false, status: 404, error: "This plan has no Current Living Expenses row to itemize." });
    expect(updateExpenseForClient).not.toHaveBeenCalled();
  });
});
