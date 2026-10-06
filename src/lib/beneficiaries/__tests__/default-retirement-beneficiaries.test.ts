import { describe, it, expect } from "vitest";
import {
  defaultRetirementBeneficiaries,
  isDefaultDesignationSet,
  type HouseholdPerson,
} from "../default-retirement-beneficiaries";

const client: HouseholdPerson = { id: "c", role: "client", relationship: "child" };
const spouse: HouseholdPerson = { id: "s", role: "spouse", relationship: "child" };
const kidA: HouseholdPerson = { id: "k1", role: "other", relationship: "child" };
const kidB: HouseholdPerson = { id: "k2", role: "other", relationship: "child" };
const kidC: HouseholdPerson = { id: "k3", role: "child", relationship: "child" };
const parent: HouseholdPerson = { id: "p", role: "other", relationship: "parent" };

describe("defaultRetirementBeneficiaries", () => {
  it("client-owned: spouse primary at 100%, children contingent equally", () => {
    expect(defaultRetirementBeneficiaries("c", [client, spouse, kidA, kidB, parent])).toEqual([
      { tier: "primary", percentage: 100, householdRole: "spouse", familyMemberId: null, sortOrder: 0 },
      { tier: "contingent", percentage: 50, householdRole: null, familyMemberId: "k1", sortOrder: 0 },
      { tier: "contingent", percentage: 50, householdRole: null, familyMemberId: "k2", sortOrder: 1 },
    ]);
  });

  it("spouse-owned: the client is primary", () => {
    const rows = defaultRetirementBeneficiaries("s", [client, spouse, kidA]);
    expect(rows[0]).toMatchObject({ tier: "primary", householdRole: "client", percentage: 100 });
    expect(rows[1]).toMatchObject({ tier: "contingent", familyMemberId: "k1", percentage: 100 });
  });

  it("three children split to exactly 100%", () => {
    const pcts = defaultRetirementBeneficiaries("c", [client, spouse, kidA, kidB, kidC])
      .filter((r) => r.tier === "contingent")
      .map((r) => r.percentage);
    expect(pcts).toEqual([33.33, 33.33, 33.34]);
  });

  it("no spouse: the children are primary", () => {
    expect(defaultRetirementBeneficiaries("c", [client, kidA, kidB]).map((r) => r.tier)).toEqual([
      "primary",
      "primary",
    ]);
  });

  it("no children: spouse primary only", () => {
    expect(defaultRetirementBeneficiaries("c", [client, spouse])).toHaveLength(1);
  });

  it("owned by anyone other than a co-client: no default", () => {
    expect(defaultRetirementBeneficiaries("k1", [client, spouse, kidA])).toEqual([]);
    expect(defaultRetirementBeneficiaries("missing", [client, spouse, kidA])).toEqual([]);
  });
});

describe("isDefaultDesignationSet", () => {
  const defaults = defaultRetirementBeneficiaries("c", [client, spouse, kidA, kidB]);
  const stored = defaults.map((d) => ({
    ...d,
    percentage: d.percentage.toFixed(2),
    externalBeneficiaryId: null,
    entityIdRef: null,
  }));

  it("matches the stored default regardless of order", () => {
    expect(isDefaultDesignationSet([...stored].reverse(), defaults)).toBe(true);
  });

  it("an edited share, an added row, or a removed row is no longer the default", () => {
    expect(isDefaultDesignationSet([{ ...stored[0], percentage: "90.00" }, ...stored.slice(1)], defaults)).toBe(false);
    expect(isDefaultDesignationSet(stored.slice(1), defaults)).toBe(false);
    expect(
      isDefaultDesignationSet(
        [...stored, { ...stored[1], familyMemberId: null, externalBeneficiaryId: "x" }],
        defaults,
      ),
    ).toBe(false);
  });
});
