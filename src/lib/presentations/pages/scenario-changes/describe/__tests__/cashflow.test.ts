import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "../resolve";
import { visibleDetail } from "../../types";

describe("cashflow/estate describers", () => {
  it("income add: type, amount, owner, window", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "income",
        targetId: "i", toggleGroupId: null, orderIndex: 0,
        payload: { type: "salary", annualAmount: 120000, owner: "client", startYear: 2026, endYear: 2030 },
      },
      { targetNames: { "income:i": "Consulting" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Income");
    expect(d).toContain("Salary");
    expect(d).toContain("$120k");
    expect(d).toContain("2026");
  });

  it("expense edit: living expense before → after", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "edit", targetKind: "expense",
        targetId: "e", toggleGroupId: null, orderIndex: 0,
        payload: { annualAmount: { from: 100000, to: 150000 } },
      },
      { targetNames: { "expense:e": "Retirement Living Expenses" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    expect(row.what).toContain("Retirement Living Expenses");
    expect(row.before).toBe("$100k");
    expect(row.after).toBe("$150k");
    // `what` names the field and the columns carry the move, so the clause
    // only restates the row — flagged, so the TABLE hides it while the Plan
    // Story chapter (which has no columns) can still quote it.
    expect(row.restatesRow).toBe(true);
    expect(visibleDetail(row, true)).toEqual([]);
    expect(row.detail).toEqual(["Adjusts this expense."]);
  });

  it("multi-field edit keeps a detail line per field", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "edit", targetKind: "expense",
        targetId: "e", toggleGroupId: null, orderIndex: 0,
        payload: { annualAmount: { from: 100000, to: 150000 }, endYear: { from: 2040, to: 2050 } },
      },
      { targetNames: { "expense:e": "Travel" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    expect(row.restatesRow).toBeUndefined();
    expect(visibleDetail(row, true)).toHaveLength(2);
    expect(row.detail.join(" ")).toContain("$100k → $150k");
    expect(row.detail.join(" ")).not.toContain("Adjusts this expense.");
  });

  it("liability add: balance, rate, payment", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "liability",
        targetId: "l", toggleGroupId: null, orderIndex: 0,
        payload: { balance: 300000, interestRate: 0.045, monthlyPayment: 1800 },
      },
      { targetNames: { "liability:l": "Mortgage" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Liabilities");
    expect(d).toContain("$300k");
  });

  it("gift add: amount, year, recipient resolved by id", () => {
    const resolve = buildResolveContext({
      accountsById: {},
      recipientsById: { "family_member:f1": "Jane Cooper" },
      entitiesById: {},
      spouseName: null,
      modelPortfoliosById: {},
      baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "gift",
        targetId: "g", toggleGroupId: null, orderIndex: 0,
        payload: { amount: 18000, year: 2027, recipientFamilyMemberId: "f1" },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Estate");
    expect(d).toContain("$18k");
    expect(d).toContain("Jane Cooper");
    expect(d).toContain("2027");
  });
});
