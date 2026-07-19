import { describe, it, expect } from "vitest";
import { computeSideTotals } from "../side-totals";
import { allocationKey, resolveAllocations, type DivisibleObject } from "../allocation-rules";

// Scenario: primary-owned account (100k), spouse-owned income (50k/yr),
// joint liability (20k) allocated `spouse`, joint account (60k) `split` 50,
// expense (30k/yr) default primary, entity (500k) `duplicate`.
const objects: DivisibleObject[] = [
  {
    kind: "account", id: "acc-primary", label: "Primary Brokerage", subtype: "taxable",
    value: 100_000, basis: 100_000, rothValue: 0, annualAmount: 0,
    ownerSide: "primary", entityOwnedById: null, childIds: [],
  },
  {
    kind: "income", id: "inc-spouse", label: "Spouse Salary", subtype: "wages",
    value: 0, basis: 0, rothValue: 0, annualAmount: 50_000,
    ownerSide: "spouse", entityOwnedById: null, childIds: [],
  },
  {
    kind: "liability", id: "liab-joint", label: "Joint Mortgage", subtype: "mortgage",
    value: 20_000, basis: 0, rothValue: 0, annualAmount: 0,
    ownerSide: "joint", entityOwnedById: null, childIds: [],
  },
  {
    kind: "account", id: "acc-joint", label: "Joint Brokerage", subtype: "taxable",
    value: 60_000, basis: 60_000, rothValue: 0, annualAmount: 0,
    ownerSide: "joint", entityOwnedById: null, childIds: [],
  },
  {
    kind: "expense", id: "exp-living", label: "Living Expenses", subtype: "living",
    value: 0, basis: 0, rothValue: 0, annualAmount: 30_000,
    ownerSide: "none", entityOwnedById: null, childIds: [],
  },
  {
    kind: "entity", id: "ent-llc", label: "Family LLC", subtype: "llc",
    value: 500_000, basis: 500_000, rothValue: 0, annualAmount: 0,
    ownerSide: "joint", entityOwnedById: null, childIds: [],
  },
];

const resolved = resolveAllocations(objects, [
  { targetKind: "liability", targetId: "liab-joint", disposition: "spouse", splitPercentToSpouse: null },
  { targetKind: "account", targetId: "acc-joint", disposition: "split", splitPercentToSpouse: "50" },
  { targetKind: "entity", targetId: "ent-llc", disposition: "duplicate", splitPercentToSpouse: null },
]);

describe("computeSideTotals", () => {
  it("computes both sides with split and duplicate handled", () => {
    const { primary, spouse } = computeSideTotals(objects, resolved);
    expect(primary.netWorth).toBe(100_000 + 30_000 + 500_000); // own acct + half split + dup entity
    expect(spouse.netWorth).toBe(30_000 - 20_000 + 500_000); // half split − liability + dup entity
    expect(spouse.annualIncome).toBe(50_000);
    expect(primary.annualExpenses).toBe(30_000);
  });

  it("skips entity-owned children (their value lives in the entity's value)", () => {
    const child: DivisibleObject = {
      kind: "account", id: "acc-child", label: "LLC-owned account", subtype: "taxable",
      value: 999_000, basis: 999_000, rothValue: 0, annualAmount: 0,
      ownerSide: "entity", entityOwnedById: "ent-llc", childIds: [],
    };
    // Deliberately give it a resolved allocation entry — computeSideTotals must
    // still skip it because entityOwnedById is set, not merely because it's
    // absent from `resolved` (resolveAllocations also skips entity-owned rows).
    const childResolved = new Map(resolved);
    childResolved.set(allocationKey("account", "acc-child"), {
      disposition: "primary",
      splitPercentToSpouse: null,
      isDefault: true,
      needsDecision: false,
    });

    const { primary, spouse } = computeSideTotals([...objects, child], childResolved);
    expect(primary.netWorth).toBe(100_000 + 30_000 + 500_000);
    expect(spouse.netWorth).toBe(30_000 - 20_000 + 500_000);
  });
});
