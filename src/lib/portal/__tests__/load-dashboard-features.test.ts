// The advisor's Budget switch has to gate the dashboard LOADER, not just the
// tiles: `dashboard-grid` hiding a tile still leaves the numbers in the RSC
// payload, and the mobile home screen (GET /api/portal/dashboard) renders from
// the same DTO with no tile-level notion of features at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" },
  clients: { _name: "clients" },
  liabilities: { _name: "liabilities" },
  plaidTransactions: { _name: "plaidTransactions" },
  scenarios: { _name: "scenarios" },
  transactionCategories: { _name: "transactionCategories" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  desc: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  gte: (...a: unknown[]) => a,
  isNull: (...a: unknown[]) => a,
  lte: (...a: unknown[]) => a,
  ne: (...a: unknown[]) => a,
  sql: (...a: unknown[]) => a,
}));

// Every table the loader touches, in call order — the proof that a switched-off
// section is never queried rather than queried-and-discarded.
const queried: string[] = [];

// One row shape serves every plaid_transactions query in this module (pace
// curve, month/prior aggregates, the to-review sample and its count).
const TXN_ROW = {
  id: "t1",
  date: "2026-06-05",
  amount: "50.00",
  type: "expense",
  total: "50.00",
  count: 1,
  name: "WHOLEFDS",
  merchantName: null,
  accountName: null,
  categoryId: null,
  categoryName: null,
  categoryColor: null,
};

function rowsFor(table: string): unknown[] {
  switch (table) {
    case "scenarios":
      return [{ id: "s1" }];
    case "clients":
      return [{ firmId: "f1" }];
    case "accounts":
      return [
        {
          id: "a1",
          name: "Checking",
          category: "cash",
          value: "1000.00",
          isDefaultChecking: false,
          parentAccountId: null,
        },
      ];
    case "plaidTransactions":
      return [TXN_ROW];
    default:
      return [];
  }
}

function chain(rows: unknown[]): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const method of ["where", "limit", "groupBy", "orderBy", "leftJoin"]) {
    c[method] = () => c;
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return c;
}

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => {
        queried.push(tbl._name);
        return chain(rowsFor(tbl._name));
      },
    }),
  },
}));

const loadBudgetSummaryMock = vi.fn();
vi.mock("@/lib/portal/load-budget-data", () => ({
  loadBudgetSummary: (...a: unknown[]) => loadBudgetSummaryMock(...a),
  currentMonthRange: (d: Date) => {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  },
}));

const loadRecurringsMock = vi.fn();
vi.mock("@/lib/portal/load-recurrings-data", () => ({
  loadRecurringsData: (...a: unknown[]) => loadRecurringsMock(...a),
}));

vi.mock("@/lib/portal/load-portal-financials", () => ({
  loadPortalDebt: () => Promise.resolve([]),
  loadPortalTrendTransactions: () => Promise.resolve([]),
}));

// The projection stack is only reached with includeGoals — stubbed so this
// file stays a test of the gating, not of goal funding.
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/engine", () => ({ runProjection: vi.fn() }));

import { loadPortalDashboard } from "@/lib/portal/load-dashboard";

const ALL_SHARED = { shareTransactions: true, shareBudgets: true, shareRecurrings: true };
const NOW = new Date("2026-06-15T00:00:00Z");

beforeEach(() => {
  queried.length = 0;
  loadBudgetSummaryMock.mockReset();
  loadBudgetSummaryMock.mockResolvedValue({
    month: "2026-06",
    totalBudget: 6650,
    totalSpent: 4967,
    totalRemaining: 1683,
    incomeThisMonth: 9000,
    groups: [{ id: "cat1", name: "Food", color: "var(--data-blue)", actual: 382, budget: 1500 }],
    excluded: [],
    totalExcluded: 0,
  });
  loadRecurringsMock.mockReset();
  loadRecurringsMock.mockResolvedValue({ recurrings: [] });
});

describe("loadPortalDashboard with the Budget feature off", () => {
  it("runs no budgeting query and ships no budgeting numbers", async () => {
    const dto = await loadPortalDashboard("c1", NOW, ALL_SHARED, {
      includeGoals: false,
      budgetEnabled: false,
    });

    expect(loadBudgetSummaryMock).not.toHaveBeenCalled();
    expect(loadRecurringsMock).not.toHaveBeenCalled();
    expect(queried).not.toContain("plaidTransactions");

    expect(dto.spending.budgeted).toBe(0);
    expect(dto.spending.spent).toBe(0);
    expect(dto.spending.groups).toEqual([]);
    expect(dto.topCategories).toEqual([]);
    expect(dto.toReview).toEqual({ count: 0, sample: [] });
    expect(dto.recurrings).toEqual([]);
    expect(dto.recurringRows).toEqual([]);
    expect(dto.netThisMonth.income).toBe(0);
    expect(dto.netThisMonth.spent).toBe(0);
  });

  it("still loads net worth — the plan tiles are not part of the section", async () => {
    const dto = await loadPortalDashboard("c1", NOW, ALL_SHARED, {
      includeGoals: false,
      budgetEnabled: false,
    });
    expect(queried).toContain("accounts");
    expect(dto.netWorth.assets).toBe(1000);
  });

  it("reports the switch on the DTO so mobile drops the same tiles", async () => {
    const off = await loadPortalDashboard("c1", NOW, ALL_SHARED, {
      includeGoals: false,
      budgetEnabled: false,
    });
    expect(off.budgetEnabled).toBe(false);
    // `sharing` keeps saying what the CLIENT chose — the two switches point in
    // opposite directions and the tiles read them differently.
    expect(off.sharing).toEqual(ALL_SHARED);
  });
});

describe("loadPortalDashboard with the Budget feature on", () => {
  it("queries and returns the budgeting data (default is on)", async () => {
    const dto = await loadPortalDashboard("c1", NOW, ALL_SHARED, {
      includeGoals: false,
    });
    expect(loadBudgetSummaryMock).toHaveBeenCalled();
    expect(loadRecurringsMock).toHaveBeenCalled();
    expect(queried).toContain("plaidTransactions");
    expect(dto.spending.budgeted).toBe(6650);
    expect(dto.budgetEnabled).toBe(true);
  });
});

