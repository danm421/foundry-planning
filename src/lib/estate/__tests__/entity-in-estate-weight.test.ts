import { describe, it, expect } from "vitest";
import {
  entityInEstateWeight,
  inEstateWeight,
  outOfEstateWeight,
} from "@/lib/estate/in-estate-weights";
import type { ClientData, EntitySummary } from "@/engine/types";

function tree(entities: EntitySummary[]): ClientData {
  return {
    client: {} as unknown as never,
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {} as unknown as never,
    entities,
    giftEvents: [],
  } as unknown as ClientData;
}

describe("entityInEstateWeight", () => {
  it("returns 1 for revocable trust", () => {
    const t = tree([{ id: "T", name: "Living", entityType: "trust", isIrrevocable: false } as EntitySummary]);
    expect(entityInEstateWeight(t, "T")).toBe(1);
  });

  it("returns 0 for irrevocable trust", () => {
    const t = tree([{ id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary]);
    expect(entityInEstateWeight(t, "T")).toBe(0);
  });

  it("returns family-owned fraction for business with only family owners", () => {
    const t = tree([{
      id: "B", name: "LLC", entityType: "llc",
      owners: [
        { kind: "family_member", familyMemberId: "fm1", percent: 0.6 },
        { kind: "family_member", familyMemberId: "fm2", percent: 0.4 },
      ],
    } as EntitySummary]);
    expect(entityInEstateWeight(t, "B")).toBeCloseTo(1.0);
  });

  it("returns 0 for business owned 100% by irrevocable trust", () => {
    const t = tree([
      { id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary,
      { id: "B", name: "LLC", entityType: "llc",
        owners: [{ kind: "entity", entityId: "T", percent: 1.0 }] } as EntitySummary,
    ]);
    expect(entityInEstateWeight(t, "B")).toBeCloseTo(0);
  });

  it("returns mixed weight for business co-owned by family + irrevocable trust", () => {
    const t = tree([
      { id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary,
      { id: "B", name: "LLC", entityType: "llc",
        owners: [
          { kind: "family_member", familyMemberId: "fm1", percent: 0.4 },
          { kind: "entity", entityId: "T", percent: 0.6 },
        ] } as EntitySummary,
    ]);
    expect(entityInEstateWeight(t, "B")).toBeCloseTo(0.4);
  });

  it("returns 1 for business owned 100% by revocable trust", () => {
    const t = tree([
      { id: "T", name: "Living", entityType: "trust", isIrrevocable: false } as EntitySummary,
      { id: "B", name: "LLC", entityType: "llc",
        owners: [{ kind: "entity", entityId: "T", percent: 1.0 }] } as EntitySummary,
    ]);
    expect(entityInEstateWeight(t, "B")).toBeCloseTo(1);
  });

  it("recurses through nested business ownership", () => {
    const t = tree([
      { id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary,
      { id: "B1", name: "Holdco", entityType: "llc",
        owners: [{ kind: "entity", entityId: "T", percent: 1.0 }] } as EntitySummary,
      { id: "B2", name: "Opco", entityType: "llc",
        owners: [{ kind: "entity", entityId: "B1", percent: 1.0 }] } as EntitySummary,
    ]);
    expect(entityInEstateWeight(t, "B2")).toBeCloseTo(0);
  });

  it("guards against cycles", () => {
    const t = tree([
      { id: "A", name: "A LLC", entityType: "llc",
        owners: [{ kind: "entity", entityId: "B", percent: 1.0 }] } as EntitySummary,
      { id: "B", name: "B LLC", entityType: "llc",
        owners: [{ kind: "entity", entityId: "A", percent: 1.0 }] } as EntitySummary,
    ]);
    // Cycle → recursion bails to 0 instead of infinite loop
    expect(() => entityInEstateWeight(t, "A")).not.toThrow();
    expect(entityInEstateWeight(t, "A")).toBe(0);
  });

  it("inEstateWeight + outOfEstateWeight sum to 1 for entity owners", () => {
    const t = tree([
      { id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary,
      { id: "B", name: "LLC", entityType: "llc",
        owners: [
          { kind: "family_member", familyMemberId: "fm1", percent: 0.4 },
          { kind: "entity", entityId: "T", percent: 0.6 },
        ] } as EntitySummary,
    ]);
    const owner = { kind: "entity" as const, entityId: "B", percent: 1.0 };
    expect(inEstateWeight(t, owner) + outOfEstateWeight(t, owner)).toBeCloseTo(1);
  });
});
