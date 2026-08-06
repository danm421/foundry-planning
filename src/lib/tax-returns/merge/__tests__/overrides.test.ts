import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";
import { applyOverrides, diffOverrides } from "../overrides";
import { deriveProvenance } from "../provenance";

describe("applyOverrides", () => {
  it("applies a scalar override", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const out = applyOverrides(base, { "income.wages": 252000 });
    expect(out.income.wages).toBe(252000);
  });

  it("does not mutate the input", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    applyOverrides(base, { "income.wages": 252000 });
    expect(base.income.wages).toBe(250000);
  });

  it("creates a nullable block when overriding into it", () => {
    const base = emptyTaxReturnFacts(2025);
    expect(base.deductions.qbi).toBeNull();
    const out = applyOverrides(base, { "deductions.qbi.w2Wages": 60000 });
    expect(out.deductions.qbi?.w2Wages).toBe(60000);
    // The materialized block must satisfy every OTHER required key too — a
    // factory that omitted one would pass the assertion above yet fail the
    // strict schema, exactly the class of bug Task 5's `setLeaf` shipped.
    expect(taxReturnFactsSchema.safeParse(out).success).toBe(true);
  });

  it("creates the income.scheduleE nullable block when overriding into it", () => {
    const base = emptyTaxReturnFacts(2025);
    expect(base.income.scheduleE).toBeNull();
    const out = applyOverrides(base, { "income.scheduleE.grossRents": 19600 });
    expect(out.income.scheduleE?.grossRents).toBe(19600);
    // `income.scheduleE` is the block with the live `.default(null)`
    // production trap: parseRowFacts re-validates persisted jsonb through
    // this exact schema on every read.
    expect(taxReturnFactsSchema.safeParse(out).success).toBe(true);
  });

  it("ignores an override into an unknown intermediate block rather than growing the object", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "income.bogusBlock.field": 1 });
    expect((out.income as Record<string, unknown>).bogusBlock).toBeUndefined();
  });

  it("applies an entity override by merge key, not index", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [
      { entityName: "Summit Holdings Inc", ein: "98-7654321", entityType: "s_corp",
        ordinaryBusinessIncome: 120000, rentalIncome: null, guaranteedPayments: null,
        section179: null, w2WagesFromEntity: null, qbiIncome: 120000, isSstb: false },
      { entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
        ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
        section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false },
    ];

    // Target the SECOND entity (index 1), not index 0 — a positional
    // implementation (`list[0]`) must fail this, not just happen to pass.
    const out = applyOverrides(base, { "k1s[12-3456789].w2WagesFromEntity": 85000 });

    expect(out.k1s.find((k) => k.ein === "12-3456789")?.w2WagesFromEntity).toBe(85000);
    expect(out.k1s.find((k) => k.ein === "98-7654321")?.w2WagesFromEntity).toBeNull();
  });

  it("ignores an entity override whose key is no longer present", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "k1s[99-9999999].w2WagesFromEntity": 85000 });
    expect(out.k1s).toHaveLength(0);
  });

  it("ignores an unknown scalar path rather than growing the object", () => {
    const base = emptyTaxReturnFacts(2025);
    const out = applyOverrides(base, { "income.bogusField": 1 });
    expect((out.income as Record<string, unknown>).bogusField).toBeUndefined();
  });
});

describe("diffOverrides", () => {
  it("captures only the fields the advisor changed", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    base.income.agi = 412000;

    const submitted = structuredClone(base);
    submitted.income.agi = 418500;

    expect(diffOverrides(base, submitted)).toEqual({ "income.agi": 418500 });
  });

  it("captures a cleared field as an explicit null", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const submitted = structuredClone(base);
    submitted.income.wages = null;

    expect(diffOverrides(base, submitted)).toEqual({ "income.wages": null });
  });

  it("round-trips through applyOverrides", () => {
    const base = emptyTaxReturnFacts(2025);
    base.income.wages = 250000;
    const submitted = structuredClone(base);
    submitted.income.wages = 251000;
    submitted.deductions.deductionTaken = "itemized";

    expect(applyOverrides(base, diffOverrides(base, submitted))).toEqual(submitted);
  });

  it("diffs entity fields by merge key", () => {
    const base = emptyTaxReturnFacts(2025);
    base.k1s = [{
      entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
      ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
      section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
    }];
    const submitted = structuredClone(base);
    submitted.k1s[0].w2WagesFromEntity = 85000;

    expect(diffOverrides(base, submitted))
      .toEqual({ "k1s[12-3456789].w2WagesFromEntity": 85000 });
  });
});

describe("deriveProvenance", () => {
  it("marks overridden paths as advisor-sourced", () => {
    const merged = { "income.wages": "doc-a", "income.agi": "doc-a" };
    const out = deriveProvenance(merged, { "income.agi": 418500 });
    expect(out["income.wages"]).toBe("doc-a");
    expect(out["income.agi"]).toBe("advisor");
  });

  it("marks an advisor-only path as advisor-sourced", () => {
    const out = deriveProvenance({}, { "income.wages": 1 });
    expect(out["income.wages"]).toBe("advisor");
  });
});
