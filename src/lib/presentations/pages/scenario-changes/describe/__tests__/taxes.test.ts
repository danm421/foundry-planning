import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";

describe("roth_conversion describer", () => {
  it("roth_conversion fixed_amount add shows amount, sources → dest, window", () => {
    const resolve = buildResolveContext({
      accountsById: {
        src: { name: "Traditional IRA", category: "retirement" },
        dst: { name: "Roth IRA", category: "retirement" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "roth_conversion",
        targetId: "r", toggleGroupId: null, orderIndex: 0,
        payload: {
          conversionType: "fixed_amount", fixedAmount: 50000,
          sourceAccountIds: ["src"], destinationAccountId: "dst",
          startYear: 2028, endYear: 2033,
        },
      },
      { targetNames: { "roth_conversion:r": "Roth ladder" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Taxes");
    expect(d).toContain("$50k/yr");
    expect(d).toContain("Traditional IRA");
    expect(d).toContain("Roth IRA");
    expect(d).toContain("2028");
  });

  it("roth_conversion full_account add shows full-account copy", () => {
    const resolve = buildResolveContext({
      accountsById: {
        src: { name: "401(k)", category: "retirement" },
        dst: { name: "Roth IRA", category: "retirement" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c2", scenarioId: "s", opType: "add", targetKind: "roth_conversion",
        targetId: "r2", toggleGroupId: null, orderIndex: 0,
        payload: {
          conversionType: "full_account",
          sourceAccountIds: ["src"], destinationAccountId: "dst",
          startYear: 2030,
        },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Taxes");
    expect(d).toContain("Convert full");
    expect(d).toContain("401(k)");
  });

  it("roth_conversion remove", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c3", scenarioId: "s", opType: "remove", targetKind: "roth_conversion",
        targetId: "r3", toggleGroupId: null, orderIndex: 0, payload: {},
      },
      { targetNames: { "roth_conversion:r3": "My Conversion" }, resolve },
    );
    expect(row.area).toBe("Taxes");
    expect(row.op).toBe("remove");
    expect(row.what).toBe("My Conversion");
  });

  it("client_deduction add shows amount", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c4", scenarioId: "s", opType: "add", targetKind: "client_deduction",
        targetId: "d1", toggleGroupId: null, orderIndex: 0,
        payload: { amount: 12000 },
      },
      { targetNames: { "client_deduction:d1": "Mortgage Interest" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Taxes");
    expect(d).toContain("$12k");
  });
});
