import { describe, it, expect } from "vitest";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
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

  // An owner change is a field-level diff, so it takes the GENERIC edit path,
  // where the payload value used to be printed verbatim — putting the raw
  // lowercase enum token for the household's second person into a before/after
  // cell on a page that IS the client deliverable. The add path never had this
  // (kinds/cashflow.ts already labels `owner`); only the edit path did.
  it("income edit: the owner enum is humanised in the before/after cells", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "edit", targetKind: "income",
        targetId: "i", toggleGroupId: null, orderIndex: 0,
        payload: { owner: { from: "client", to: "spouse" } },
      },
      { targetNames: { "income:i": "Consulting" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    expect(row.before).toBe("Client");
    expect(row.after).toBe(CO_CLIENT_LABEL);
  });

  // Same defect on the multi-field path, which builds "Label: from → to"
  // detail segments instead of columns — and on `grantor`, the gift's copy of
  // the same client/spouse/joint enum.
  it("gift edit: the grantor enum is humanised in the detail segments", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "edit", targetKind: "gift",
        targetId: "g", toggleGroupId: null, orderIndex: 0,
        payload: { grantor: { from: "client", to: "spouse" }, amount: { from: 10000, to: 20000 } },
      },
      { targetNames: { "gift:g": "Annual exclusion gift" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    expect(row.detail.join(" ")).toContain(`Grantor: Client \u2192 ${CO_CLIENT_LABEL}`);
  });

  // The guard: a field whose NAME is owner-ish but whose VALUE is an id must
  // keep falling through untouched, the way row-lines.ts scopes its own map.
  it("leaves an owning-entity id alone", () => {
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "edit", targetKind: "income",
        targetId: "i", toggleGroupId: null, orderIndex: 0,
        payload: { ownerEntityId: { from: "spouse-trust-1", to: "client-trust-2" } },
      },
      { targetNames: { "income:i": "Consulting" }, resolve: buildResolveContext(EMPTY_RESOLVE_DATA) },
    );
    expect(row.before).toBe("spouse-trust-1");
    expect(row.after).toBe("client-trust-2");
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
