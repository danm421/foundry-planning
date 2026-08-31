import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// A savings rule's "salary basis" is stored in TWO places: `salary_basis` is a
// column on the rule, but the salaries a "selected" basis names live in the
// `savings_rule_salary_incomes` join table. This GET is the only read the
// Accounts → Savings tab has, and returning the column WITHOUT the join list
// is worse than returning neither: the edit dialog seeds its panel from
// `salaryIncomeIds`, finds nothing, falls back to "owner", and the next
// "Save Changes" replaces the advisor's picks with an empty list. So the
// property under test is that every rule comes back carrying its own ids.
//
// The fake DB below models one behaviour of Postgres deliberately: rows come
// back in storage order unless the query ORDERs them. `sortOrder` is what
// makes a selected list stable, so the seed data is stored out of order and
// only `.orderBy(...)` sorts it.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const state: { scenarios: Row[]; savingsRules: Row[]; salaryIncomes: Row[] } = {
  scenarios: [],
  savingsRules: [],
  salaryIncomes: [],
};

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  const rowsFor = (table: unknown): Row[] =>
    table === schema.scenarios
      ? state.scenarios
      : table === schema.savingsRules
        ? state.savingsRules
        : table === schema.savingsRuleSalaryIncomes
          ? state.salaryIncomes
          : [];

  const bySortOrder = (rows: Row[]): Row[] =>
    [...rows].sort(
      (a, b) =>
        String(a.savingsRuleId).localeCompare(String(b.savingsRuleId)) ||
        Number(a.sortOrder) - Number(b.sortOrder),
    );

  const makeResult = (rows: Row[]) => ({
    then: (r: (v: Row[]) => unknown) => Promise.resolve(rows).then(r),
    orderBy: () => makeResult(bySortOrder(rows)),
  });

  const db = {
    select: () => ({
      from: (table: unknown) => ({ where: () => makeResult(rowsFor(table)) }),
    }),
  };
  return { db };
});

vi.mock("@/lib/clients/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/authz")>();
  return { ...actual, verifyClientAccess: vi.fn(async () => ({ ok: true })) };
});

import { GET } from "../route";

const params = Promise.resolve({ id: "client-1" });

function rule(id: string, extra: Row = {}): Row {
  return {
    id,
    clientId: "client-1",
    scenarioId: "scen-1",
    accountId: "acct-1",
    annualAmount: "10000",
    annualPercent: null,
    salaryBasis: "owner",
    ...extra,
  };
}

beforeEach(() => {
  state.scenarios = [{ id: "scen-1", clientId: "client-1", isBaseCase: true }];
  state.savingsRules = [];
  state.salaryIncomes = [];
});

describe("GET /api/clients/[id]/savings-rules", () => {
  it("attaches each rule's own salary income ids, in sort order", async () => {
    state.savingsRules = [
      rule("sr-selected", { salaryBasis: "selected", annualPercent: "0.06" }),
      rule("sr-owner"),
    ];
    // Stored out of sort order on purpose: without the query's ORDER BY the
    // advisor's list comes back reversed, and `sortOrder` is the only thing
    // that makes a "selected" list stable across reloads.
    state.salaryIncomes = [
      { savingsRuleId: "sr-selected", incomeId: "inc-2", sortOrder: 1 },
      { savingsRuleId: "sr-selected", incomeId: "inc-1", sortOrder: 0 },
    ];

    const res = await GET({} as never, { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    const selected = body.find((r) => r.id === "sr-selected");
    expect(selected).toMatchObject({
      salaryBasis: "selected",
      salaryIncomeIds: ["inc-1", "inc-2"],
    });
    // The other rule must NOT inherit them — a blanket attach would silently
    // widen an owner-basis rule's salary base the moment it went percent.
    expect(body.find((r) => r.id === "sr-owner")).toMatchObject({
      salaryIncomeIds: [],
    });
  });
});
