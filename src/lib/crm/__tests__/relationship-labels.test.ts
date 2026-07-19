import { describe, it, expect } from "vitest";
import {
  CRM_HOUSEHOLD_RELATIONSHIP_TYPES,
  RELATIONSHIP_PICKER_OPTIONS,
  counterpartLabel,
  toCanonicalColumns,
} from "../relationship-labels";

describe("counterpartLabel", () => {
  it("renders the child link correctly from both sides", () => {
    // canonical: from is the child of to → on the child's page the
    // counterpart (parents) is labeled Parent, and vice versa.
    expect(counterpartLabel("child", "from")).toBe("Parent");
    expect(counterpartLabel("child", "to")).toBe("Child");
  });

  it("renders referral direction from both sides", () => {
    expect(counterpartLabel("referral_source", "from")).toBe("Referred household");
    expect(counterpartLabel("referral_source", "to")).toBe("Referred by");
  });

  it("is symmetric for the non-directional types", () => {
    for (const type of ["sibling", "spouse", "ex_spouse", "business_partner", "other"] as const) {
      expect(counterpartLabel(type, "from")).toBe(counterpartLabel(type, "to"));
    }
  });

  it("has a non-empty label for every type on both sides", () => {
    for (const type of CRM_HOUSEHOLD_RELATIONSHIP_TYPES) {
      expect(counterpartLabel(type, "from").length).toBeGreaterThan(0);
      expect(counterpartLabel(type, "to").length).toBeGreaterThan(0);
    }
  });
});

describe("RELATIONSHIP_PICKER_OPTIONS", () => {
  it("offers both directions for directional types and one for symmetric", () => {
    const byType = new Map<string, number>();
    for (const o of RELATIONSHIP_PICKER_OPTIONS) byType.set(o.type, (byType.get(o.type) ?? 0) + 1);
    expect(byType.get("child")).toBe(2);
    expect(byType.get("referral_source")).toBe(2);
    expect(byType.get("sibling")).toBe(1);
    expect(byType.get("other")).toBe(1);
  });

  it("has unique values", () => {
    const values = RELATIONSHIP_PICKER_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("toCanonicalColumns", () => {
  it("puts the viewer in the from column when viewerSide is from", () => {
    expect(toCanonicalColumns({ viewerSide: "from", viewerHouseholdId: "A", counterpartHouseholdId: "B" }))
      .toEqual({ fromHouseholdId: "A", toHouseholdId: "B" });
  });
  it("puts the viewer in the to column when viewerSide is to", () => {
    expect(toCanonicalColumns({ viewerSide: "to", viewerHouseholdId: "A", counterpartHouseholdId: "B" }))
      .toEqual({ fromHouseholdId: "B", toHouseholdId: "A" });
  });
});
