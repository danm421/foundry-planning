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

// Post business-as-asset migration, entityInEstateWeight is trust-only —
// business entities live in `data.accounts` and are weighted via account-owner
// rules (see in-estate-at-year for the account loop). The tests below exercise
// the trust path; business-entity weighting is covered by the per-account
// tests in `in-estate-at-year.test.ts`.

describe("entityInEstateWeight", () => {
  it("returns 1 for revocable trust", () => {
    const t = tree([{ id: "T", name: "Living", entityType: "trust", isIrrevocable: false } as EntitySummary]);
    expect(entityInEstateWeight(t, "T")).toBe(1);
  });

  it("returns 0 for irrevocable trust", () => {
    const t = tree([{ id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary]);
    expect(entityInEstateWeight(t, "T")).toBe(0);
  });

  it("returns 0 for an unknown entity id", () => {
    const t = tree([{ id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary]);
    expect(entityInEstateWeight(t, "missing")).toBe(0);
  });

  it("inEstateWeight + outOfEstateWeight sum to 1 for a trust owner with a known entity", () => {
    const t = tree([{ id: "T", name: "ILIT", entityType: "trust", isIrrevocable: true } as EntitySummary]);
    const owner = { kind: "entity" as const, entityId: "T", percent: 1.0 };
    expect(inEstateWeight(t, owner) + outOfEstateWeight(t, owner)).toBeCloseTo(1);
  });

  it("orphan entity returns 0 from BOTH weights (drops slice from totals)", () => {
    const t = tree([]);
    const owner = { kind: "entity" as const, entityId: "orphan", percent: 1.0 };
    expect(inEstateWeight(t, owner)).toBe(0);
    expect(outOfEstateWeight(t, owner)).toBe(0);
  });
});
