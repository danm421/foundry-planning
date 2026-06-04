import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";

describe("transfer/account describers", () => {
  it("transfer add shows amount, source → target, mode, timing", () => {
    const resolve = buildResolveContext({
      accountsById: {
        s: { name: "Joint Brokerage", category: "taxable" },
        t: { name: "Business", category: "business" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "transfer",
        targetId: "tr1", toggleGroupId: null, orderIndex: 0,
        payload: {
          sourceAccountId: "s", targetAccountId: "t",
          amount: 250000, mode: "one_time", startYear: 2027,
        },
      },
      { targetNames: { "transfer:tr1": "cash to business" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Assets");
    expect(d).toContain("$250k");
    expect(d).toContain("Joint Brokerage");
    expect(d).toContain("Business");
    expect(d).toContain("2027");
  });

  it("transfer add with recurring mode shows year range", () => {
    const resolve = buildResolveContext({
      accountsById: {
        s: { name: "Checking", category: "cash" },
        t: { name: "Brokerage", category: "taxable" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c2", scenarioId: "s", opType: "add", targetKind: "transfer",
        targetId: "tr2", toggleGroupId: null, orderIndex: 0,
        payload: {
          sourceAccountId: "s", targetAccountId: "t",
          amount: 10000, mode: "recurring", startYear: 2027, endYear: 2035,
        },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("2027");
    expect(d).toContain("2035");
  });

  it("transfer remove", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c3", scenarioId: "s", opType: "remove", targetKind: "transfer",
        targetId: "tr3", toggleGroupId: null, orderIndex: 0, payload: {},
      },
      { targetNames: { "transfer:tr3": "My Transfer" }, resolve },
    );
    expect(row.area).toBe("Assets");
    expect(row.op).toBe("remove");
    expect(row.what).toBe("My Transfer");
  });

  it("account add shows category and value", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c4", scenarioId: "s", opType: "add", targetKind: "account",
        targetId: "ac1", toggleGroupId: null, orderIndex: 0,
        payload: { category: "taxable", value: 50000 },
      },
      { targetNames: { "account:ac1": "My Brokerage" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Assets");
    expect(d).toContain("Taxable");
    expect(d).toContain("$50k");
  });

  it("transfer_schedule add shows custom schedule copy", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c5", scenarioId: "s", opType: "add", targetKind: "transfer_schedule",
        targetId: "ts1", toggleGroupId: null, orderIndex: 0, payload: {},
      },
      { targetNames: { "transfer_schedule:ts1": "Annual Gift Schedule" }, resolve },
    );
    expect(row.area).toBe("Assets");
    expect(row.detail.join(" ")).toContain("Custom per-year");
  });
});
