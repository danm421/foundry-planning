// src/lib/tax-ledger/build-entity-sections.test.ts
import { describe, expect, it } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { EntityCashFlowRow } from "@/engine/entity-cashflow";
import { buildEntitySections } from "./build-entity-sections";

function yearWith(entities: Array<[string, EntityCashFlowRow]>): ProjectionYear {
  return { year: 2030, entityCashFlow: new Map(entities) } as unknown as ProjectionYear;
}

const business: EntityCashFlowRow = {
  kind: "business", entityId: "b1", entityName: "Business 1", year: 2030, ages: { client: 60 },
  entityType: "s_corp", beginningTotalValue: 0, beginningBasis: 0, growth: 0,
  income: 1000, expenses: 0, annualDistribution: 1000, retainedEarnings: 0,
  endingTotalValue: 0, endingBasis: 0,
} as EntityCashFlowRow;

const grantorTrust: EntityCashFlowRow = {
  kind: "trust", entityId: "t1", entityName: "Grantor Trust", year: 2030, ages: { client: 60 },
  trustSubType: "idgt", isGrantor: true, beginningBalance: 0, transfersIn: 0, growth: 0,
  income: 2000, totalDistributions: 0, expenses: 0, taxes: 0, endingBalance: 0,
} as EntityCashFlowRow;

const nonGrantorTrust: EntityCashFlowRow = {
  kind: "trust", entityId: "t2", entityName: "Special Needs Trust", year: 2030, ages: { client: 60 },
  trustSubType: "irrevocable", isGrantor: false, beginningBalance: 0, transfersIn: 0, growth: 0,
  income: 3810, totalDistributions: 1000, expenses: 0, taxes: 500, endingBalance: 0,
} as EntityCashFlowRow;

describe("buildEntitySections", () => {
  it("renders a pass-through business with an offsetting line that nets to retained earnings", () => {
    const [s] = buildEntitySections(yearWith([["b1", business]]));
    expect(s.kind).toBe("business");
    expect(s.passThrough).toBe(true);
    expect(s.rows.find((r) => r.type === "Business Income")?.amount).toBe(1000);
    expect(s.rows.find((r) => r.type === "Pass-Thru to Household")?.amount).toBe(-1000);
    expect(s.subtotal).toBe(0);
  });

  it("renders a grantor trust as pass-through", () => {
    const [s] = buildEntitySections(yearWith([["t1", grantorTrust]]));
    expect(s.passThrough).toBe(true);
    expect(s.rows.find((r) => r.type === "Pass-Thru to Grantor")?.amount).toBe(-2000);
    expect(s.subtotal).toBe(0);
  });

  it("renders a non-grantor trust as its own taxpayer (no pass-thru line)", () => {
    const [s] = buildEntitySections(yearWith([["t2", nonGrantorTrust]]));
    expect(s.passThrough).toBe(false);
    expect(s.rows.find((r) => r.type.startsWith("Pass-Thru"))).toBeUndefined();
    expect(s.rows.find((r) => r.type === "Trust Income")?.amount).toBe(3810);
    expect(s.rows.find((r) => r.type === "Distributions")?.amount).toBe(-1000);
  });

  it("suppresses entities with no activity", () => {
    const empty = { ...business, income: 0, expenses: 0, annualDistribution: 0 };
    const sections = buildEntitySections(yearWith([["b1", empty as EntityCashFlowRow]]));
    expect(sections).toHaveLength(0);
  });
});
