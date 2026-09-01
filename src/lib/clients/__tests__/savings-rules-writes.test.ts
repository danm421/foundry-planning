import { describe, expect, it, vi, beforeEach } from "vitest";

const setSpy = vi.fn();
const insertSpy = vi.fn();
// The salary-income rows are written inside a db.transaction, through the real
// replaceSalaryIncomes. These two capture what that transaction body issued.
const txDeleteSpy = vi.fn();
const txInsertSpy = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertSpy(v);
        return { returning: async () => [{ id: "rule-1", accountId: "acct-1" }] };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        setSpy(patch);
        return { where: () => ({ returning: async () => [{ id: "rule-1", accountId: "acct-1" }] }) };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "rule-1", clientId: "c1" }] }) }) }),
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        delete: () => ({ where: (w: unknown) => { txDeleteSpy(w); return Promise.resolve(); } }),
        insert: () => ({ values: (v: unknown) => { txInsertSpy(v); return Promise.resolve(); } }),
      }),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
type FkCheck = { ok: true } | { ok: false; reason: string };
// Reached through a closure below, never referenced directly in the vi.mock
// factory: the factory is hoisted above this line and would read it too early.
const assertIncomesSpy = vi.fn<(clientId: string, ids: string[]) => Promise<FkCheck>>();
vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: async () => ({ ok: true }),
  assertIncomesInClient: (...args: [string, string[]]) => assertIncomesSpy(...args),
}));
vi.mock("../base-case", () => ({ baseCaseScenarioId: async () => "scen-1" }));

import { createSavingsRuleForClient, updateSavingsRuleForClient } from "../savings-rules-writes";

describe("updateSavingsRuleForClient", () => {
  beforeEach(() => setSpy.mockClear());

  it("is a TRUE partial patch — omitted columns are never written", async () => {
    // The portal's savings form sends four keys. If update were a full replace,
    // this call would null employerMatchPct/contributeMax on an advisor-built
    // rule. That is the regression this test exists to catch.
    await updateSavingsRuleForClient({
      clientId: "c1",
      firmId: "f1",
      actorId: "u1",
      ruleId: "rule-1",
      input: { annualAmount: "500", startYear: 2026, endYear: 2040, accountId: "acct-1" },
    });

    const patch = setSpy.mock.calls[0][0];
    expect(patch).toHaveProperty("annualAmount", "500");
    expect(patch).not.toHaveProperty("employerMatchPct");
    expect(patch).not.toHaveProperty("contributeMax");
    expect(patch).not.toHaveProperty("annualPercent");
    expect(patch).not.toHaveProperty("rothPercent");
  });

  it("writes an explicit null when a nullable field is present-and-null", async () => {
    await updateSavingsRuleForClient({
      clientId: "c1",
      firmId: "f1",
      actorId: "u1",
      ruleId: "rule-1",
      input: { employerMatchPct: null },
    });
    expect(setSpy.mock.calls[0][0]).toHaveProperty("employerMatchPct", null);
  });
});

describe("salary basis", () => {
  beforeEach(() => {
    setSpy.mockClear();
    insertSpy.mockClear();
    txDeleteSpy.mockClear();
    txInsertSpy.mockClear();
    assertIncomesSpy.mockReset();
    assertIncomesSpy.mockResolvedValue({ ok: true });
  });

  const createArgs = (input: Record<string, unknown> = {}) => ({
    clientId: "c1",
    firmId: "f1",
    actorId: "u1",
    input: { accountId: "acct-1", startYear: 2026, endYear: 2040, ...input },
  });
  const updateArgs = (input: Record<string, unknown>) => ({
    clientId: "c1",
    firmId: "f1",
    actorId: "u1",
    ruleId: "rule-1",
    input,
  });

  it("defaults a new rule to owner", async () => {
    await createSavingsRuleForClient(createArgs());
    expect(insertSpy.mock.calls[0][0]).toHaveProperty("salaryBasis", "owner");
    expect(txInsertSpy).not.toHaveBeenCalled();
  });

  it("stores the selected salaries in draw order", async () => {
    await createSavingsRuleForClient(
      createArgs({ salaryBasis: "selected", salaryIncomeIds: ["inc-b", "inc-a"] }),
    );
    expect(insertSpy.mock.calls[0][0]).toHaveProperty("salaryBasis", "selected");
    expect(txInsertSpy.mock.calls[0][0]).toEqual([
      { savingsRuleId: "rule-1", incomeId: "inc-b", sortOrder: 0 },
      { savingsRuleId: "rule-1", incomeId: "inc-a", sortOrder: 1 },
    ]);
  });

  it("stores 'owner' when 'selected' arrives with nothing selected", async () => {
    // projection.ts resolves a "selected" rule with no rows down the owner path.
    // Storing "selected" anyway would leave the UI showing a basis the plan does
    // not use — a percent contributing against the account owner, unannounced.
    await createSavingsRuleForClient(createArgs({ salaryBasis: "selected", salaryIncomeIds: [] }));
    expect(insertSpy.mock.calls[0][0]).toHaveProperty("salaryBasis", "owner");
    expect(txInsertSpy).not.toHaveBeenCalled();
  });

  it("leaves the basis AND its salary rows alone when the payload omits it", async () => {
    // The portal Organizer's simplified form sends four keys and never mentions
    // the basis. Writing the column, or running the row replace, would wipe an
    // advisor's selection on every client edit.
    await updateSavingsRuleForClient(updateArgs({ annualAmount: "1234" }));
    expect(setSpy.mock.calls[0][0]).not.toHaveProperty("salaryBasis");
    expect(txDeleteSpy).not.toHaveBeenCalled();
    expect(txInsertSpy).not.toHaveBeenCalled();
  });

  it("replaces the salary rows when an update names 'selected'", async () => {
    await updateSavingsRuleForClient(
      updateArgs({ salaryBasis: "selected", salaryIncomeIds: ["inc-a"] }),
    );
    expect(setSpy.mock.calls[0][0]).toHaveProperty("salaryBasis", "selected");
    expect(txInsertSpy.mock.calls[0][0]).toEqual([
      { savingsRuleId: "rule-1", incomeId: "inc-a", sortOrder: 0 },
    ]);
  });

  it("refuses a create naming an income that is not this client's", async () => {
    // savings_rule_salary_incomes.income_id is an unrestricted FK. Without this
    // guard an advisor could name another client's income id and have it stored
    // — the cross-tenant FK injection db-scoping.ts exists to stop.
    assertIncomesSpy.mockResolvedValue({ ok: false, reason: "Income inc-x not owned by this client" });
    const res = await createSavingsRuleForClient(
      createArgs({ salaryBasis: "selected", salaryIncomeIds: ["inc-x"] }),
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(400);
    expect(assertIncomesSpy).toHaveBeenCalledWith("c1", ["inc-x"]);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(txInsertSpy).not.toHaveBeenCalled();
  });

  it("refuses an update naming an income that is not this client's", async () => {
    assertIncomesSpy.mockResolvedValue({ ok: false, reason: "Income inc-x not owned by this client" });
    const res = await updateSavingsRuleForClient(
      updateArgs({ salaryBasis: "selected", salaryIncomeIds: ["inc-x"] }),
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
    expect(txInsertSpy).not.toHaveBeenCalled();
  });

  it("clears the salary rows when the basis moves off selected", async () => {
    await updateSavingsRuleForClient(updateArgs({ salaryBasis: "all" }));
    expect(setSpy.mock.calls[0][0]).toHaveProperty("salaryBasis", "all");
    expect(txDeleteSpy).toHaveBeenCalledTimes(1);
    expect(txInsertSpy).not.toHaveBeenCalled();
  });
});
