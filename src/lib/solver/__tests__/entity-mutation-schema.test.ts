import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

const ilit = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, isGrantor: false, includeInPortfolio: false, grantor: "client", trustSubType: "ilit", crummeyPowers: true };
const idgt = { id: "t2", name: "IDGT", entityType: "trust", isIrrevocable: true, isGrantor: true, includeInPortfolio: false, grantor: "spouse", trustSubType: "idgt" };

describe("SOLVER_MUTATION_SCHEMA — entity-upsert", () => {
  it("accepts an ILIT", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: ilit }).success).toBe(true);
  });
  it("accepts an IDGT", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t2", value: idgt }).success).toBe(true);
  });
  it("accepts a delete (value:null)", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: null }).success).toBe(true);
  });
  it("rejects a bad trustSubType", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: { ...ilit, trustSubType: "bogus" } }).success).toBe(false);
  });
  it("rejects a missing entityType", () => {
    const { entityType, ...noType } = ilit;
    void entityType;
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: noType }).success).toBe(false);
  });
});

// ── Fields the trust editor writes ───────────────────────────────────────────
// ENTITY_VALUE stays `.passthrough()`, so these fields survive a parse today
// but are completely UNVALIDATED. Spelling them out is the guard: a Zod object
// that forgot a field has already shipped here once (it stripped a gift's
// valuation discount). Asserting `success` alone would pass before the change
// and pin nothing — so the real red below is the two REJECTION tests.
describe("ENTITY_VALUE — fields the trust editor writes", () => {
  const base = {
    id: "ent-1",
    name: "Smith Family ILIT",
    entityType: "trust",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
  };

  // Narrow on the discriminant rather than casting: `r.data as { value: ... }`
  // is a TS2352 error, because the mutation union has members with no `value`
  // field at all (stress-inflation, life-expectancy, surplus-allocation).
  function parse(value: Record<string, unknown>) {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "ent-1", value });
    return {
      ok: r.success,
      value: r.success && r.data.kind === "entity-upsert" ? r.data.value : null,
    };
  }

  it("preserves trustee and notes", () => {
    const r = parse({ ...base, trustee: "Linda", notes: "Reviewed 2026-09-11" });
    expect(r.ok).toBe(true);
    expect(r.value?.trustee).toBe("Linda");
    expect(r.value?.notes).toBe("Reviewed 2026-09-11");
  });

  it("accepts a null trustee and a null note, which is how the DB stores 'unset'", () => {
    const r = parse({ ...base, trustee: null, notes: null });
    expect(r.ok).toBe(true);
  });

  it("preserves the distribution policy as NUMBERS, not strings", () => {
    const r = parse({ ...base, distributionMode: "pct_liquid", distributionPercent: 0.04 });
    expect(r.ok).toBe(true);
    expect(r.value?.distributionMode).toBe("pct_liquid");
    // typeof, not ==: "0.04" == 0.04 is true and would pass on a string.
    expect(typeof r.value?.distributionPercent).toBe("number");
  });

  it("accepts every distribution mode the engine union declares", () => {
    // engine/types.ts: distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null
    for (const mode of ["fixed", "pct_liquid", "pct_income"]) {
      expect(parse({ ...base, distributionMode: mode }).ok).toBe(true);
    }
    expect(parse({ ...base, distributionMode: null }).ok).toBe(true);
  });

  it("accepts both flow modes the engine union declares", () => {
    // engine/types.ts: type EntityFlowMode = "annual" | "schedule"
    expect(parse({ ...base, flowMode: "annual" }).ok).toBe(true);
    expect(parse({ ...base, flowMode: "schedule" }).ok).toBe(true);
  });

  it("preserves income and remainder beneficiary lists", () => {
    const r = parse({
      ...base,
      incomeBeneficiaries: [{ familyMemberId: "fm-1", percentage: 100 }],
      remainderBeneficiaries: [{ familyMemberId: "fm-2", percentage: 100 }],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.incomeBeneficiaries).toHaveLength(1);
    expect(r.value?.remainderBeneficiaries).toHaveLength(1);
  });

  it("rejects a distribution mode outside the enum", () => {
    expect(parse({ ...base, distributionMode: "whenever" }).ok).toBe(false);
  });

  it("rejects a flow mode outside the enum", () => {
    expect(parse({ ...base, flowMode: "monthly" }).ok).toBe(false);
  });

  it("rejects a stringified distribution percent", () => {
    // A numeric field arriving as a string makes the engine concatenate:
    // 1 + "0.03" is "10.03". That has shipped to production here.
    expect(parse({ ...base, distributionPercent: "0.04" }).ok).toBe(false);
    expect(parse({ ...base, distributionAmount: "5000" }).ok).toBe(false);
  });
});
