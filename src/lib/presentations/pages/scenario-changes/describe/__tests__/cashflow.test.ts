import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "../resolve";

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
