import { describe, it, expect } from "vitest";
import { accountCreateSchema, accountUpdateSchema } from "../accounts";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("accountCreateSchema parity with inline route coercion", () => {
  const base = { name: "Brokerage", category: "investment" };

  it("accepts minimal required set and defaults loose fields (route insert block)", () => {
    const r = accountCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Brokerage");
      expect(r.data.category).toBe("investment");
      expect(r.data.subType).toBe("other");
      expect(r.data.value).toBe("0");
      expect(r.data.basis).toBe("0");
      expect(r.data.rothValue).toBe("0");
      expect(r.data.growthRate).toBeNull();
      expect(r.data.rmdEnabled).toBe(false);
      expect(r.data.priorYearEndValue).toBeNull();
      expect(r.data.growthSource).toBe("default");
      expect(r.data.modelPortfolioId).toBeNull();
      expect(r.data.tickerPortfolioId).toBeNull();
      expect(r.data.turnoverPct).toBe("0");
      expect(r.data.overridePctOi).toBeNull();
      expect(r.data.overridePctLtCg).toBeNull();
      expect(r.data.overridePctQdiv).toBeNull();
      expect(r.data.overridePctTaxExempt).toBeNull();
      expect(r.data.annualPropertyTax).toBe("0");
      expect(r.data.propertyTaxGrowthRate).toBe("0.03");
      expect(r.data.propertyTaxGrowthSource).toBe("custom");
      expect(r.data.titlingType).toBe("jtwros");
      expect(r.data.parentAccountId).toBeNull();
      expect(r.data.custodian).toBeNull();
      expect(r.data.accountNumberLast4).toBeNull();
    }
  });

  // ── decOrZero parity for value/basis/rothValue ────────────────────────────

  it('value: "" → "0"', () => {
    expect(accountCreateSchema.parse({ ...base, value: "" }).value).toBe("0");
  });

  it('value: "  " (whitespace) → "0"', () => {
    expect(accountCreateSchema.parse({ ...base, value: "  " }).value).toBe("0");
  });

  it('value: 1500 (number) → "1500"', () => {
    expect(accountCreateSchema.parse({ ...base, value: 1500 }).value).toBe("1500");
  });

  it('value: "2500.50" (non-empty string) → "2500.50" (passes through unchanged)', () => {
    expect(accountCreateSchema.parse({ ...base, value: "2500.50" }).value).toBe("2500.50");
  });

  it('value: 100000 → "100000" (matches AddBusinessInputSchema coerced numeric stringified)', () => {
    expect(accountCreateSchema.parse({ ...base, value: 100000 }).value).toBe("100000");
  });

  it('value: "100000" → "100000"', () => {
    expect(accountCreateSchema.parse({ ...base, value: "100000" }).value).toBe("100000");
  });

  it("same decOrZero for basis and rothValue", () => {
    expect(accountCreateSchema.parse({ ...base, basis: "" }).basis).toBe("0");
    expect(accountCreateSchema.parse({ ...base, basis: 50000 }).basis).toBe("50000");
    expect(accountCreateSchema.parse({ ...base, rothValue: "1234.56" }).rothValue).toBe("1234.56");
    expect(accountCreateSchema.parse({ ...base, rothValue: null }).rothValue).toBe("0");
  });

  // ── growthRate is NOT decOrZero — nullable passthrough ──────────────────────

  it("growthRate: passthrough (not decOrZero)", () => {
    expect(accountCreateSchema.parse({ ...base, growthRate: 0.05 }).growthRate).toBe(0.05);
    expect(accountCreateSchema.parse({ ...base, growthRate: "0.05" }).growthRate).toBe("0.05");
    expect(accountCreateSchema.parse({ ...base, growthRate: null }).growthRate).toBeNull();
    expect(accountCreateSchema.parse(base).growthRate).toBeNull();
  });

  // ── nullable passthrough fields ─────────────────────────────────────────────

  it("priorYearEndValue passthrough, default null", () => {
    expect(accountCreateSchema.parse({ ...base, priorYearEndValue: "1000" }).priorYearEndValue).toBe("1000");
    expect(accountCreateSchema.parse(base).priorYearEndValue).toBeNull();
  });

  it("overridePct* passthrough, default null", () => {
    const r = accountCreateSchema.parse({ ...base, overridePctOi: "0.2", overridePctLtCg: "0.3" });
    expect(r.overridePctOi).toBe("0.2");
    expect(r.overridePctLtCg).toBe("0.3");
    expect(r.overridePctQdiv).toBeNull();
    expect(r.overridePctTaxExempt).toBeNull();
  });

  // ── required field enforcement ──────────────────────────────────────────────

  it("missing category → REJECT", () => {
    expect(accountCreateSchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("missing name → REJECT", () => {
    expect(accountCreateSchema.safeParse({ category: "investment" }).success).toBe(false);
  });

  it("empty name → REJECT", () => {
    expect(accountCreateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("empty category → REJECT", () => {
    expect(accountCreateSchema.safeParse({ ...base, category: "" }).success).toBe(false);
  });

  // ── loose FK passthrough + uuid validation ──────────────────────────────────

  it("modelPortfolioId: valid uuid passes zod", () => {
    const r = accountCreateSchema.safeParse({ ...base, modelPortfolioId: UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.modelPortfolioId).toBe(UUID);
  });

  it("modelPortfolioId: non-uuid string → REJECT (uuidSchema)", () => {
    expect(accountCreateSchema.safeParse({ ...base, modelPortfolioId: "not-a-uuid" }).success).toBe(false);
  });

  it("tickerPortfolioId / parentAccountId / ownerEntityId: valid uuids pass", () => {
    const r = accountCreateSchema.safeParse({
      ...base,
      tickerPortfolioId: UUID,
      parentAccountId: UUID2,
      ownerEntityId: UUID,
    });
    expect(r.success).toBe(true);
  });

  it("parentAccountId: non-uuid → REJECT", () => {
    expect(accountCreateSchema.safeParse({ ...base, parentAccountId: "nope" }).success).toBe(false);
  });

  // ── business superRefine delegation ─────────────────────────────────────────

  it("business happy path: delegates to AddBusinessInputSchema and accepts", () => {
    const r = accountCreateSchema.safeParse({
      name: "Acme LLC",
      category: "business",
      businessType: "llc",
      value: 100000,
      basis: 50000,
      owners: [{ kind: "family_member", familyMemberId: UUID, percent: 1 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // generic create coercions still applied alongside the business validation
      expect(r.data.value).toBe("100000");
      expect(r.data.basis).toBe("50000");
      expect(r.data.businessType).toBe("llc");
    }
  });

  it("business invalid: missing businessType → REJECT (superRefine surfaces business message)", () => {
    const r = accountCreateSchema.safeParse({
      name: "Acme",
      category: "business",
      value: 100000,
      basis: 50000,
      owners: [{ kind: "family_member", familyMemberId: UUID, percent: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("business invalid: owners not summing to 100% → REJECT", () => {
    const r = accountCreateSchema.safeParse({
      name: "Acme LLC",
      category: "business",
      businessType: "llc",
      value: 100000,
      basis: 50000,
      owners: [{ kind: "family_member", familyMemberId: UUID, percent: 0.5 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /100%/.test(i.message))).toBe(true);
    }
  });

  it("business invalid: empty owners → REJECT", () => {
    const r = accountCreateSchema.safeParse({
      name: "Acme LLC",
      category: "business",
      businessType: "llc",
      value: 100000,
      basis: 50000,
      owners: [],
    });
    expect(r.success).toBe(false);
  });

  it("non-business (investment) with no business fields → ACCEPT (superRefine does not run)", () => {
    const r = accountCreateSchema.safeParse({ name: "Brokerage", category: "investment" });
    expect(r.success).toBe(true);
  });

  // ── boolean / passthrough business fields ───────────────────────────────────

  it("rmdEnabled coerces / defaults false", () => {
    expect(accountCreateSchema.parse({ ...base, rmdEnabled: true }).rmdEnabled).toBe(true);
    expect(accountCreateSchema.parse(base).rmdEnabled).toBe(false);
  });

  it("countsTowardAum defaults false on create", () => {
    expect(accountCreateSchema.parse(base).countsTowardAum).toBe(false);
  });

  it("countsTowardAum is honored when explicitly set on create", () => {
    expect(
      accountCreateSchema.parse({ ...base, countsTowardAum: true }).countsTowardAum,
    ).toBe(true);
  });

  it("countsTowardAum round-trips both booleans through update", () => {
    expect(accountUpdateSchema.parse({ countsTowardAum: true }).countsTowardAum).toBe(true);
    // false must survive — this is how an advisor un-flags an account.
    expect(accountUpdateSchema.parse({ countsTowardAum: false }).countsTowardAum).toBe(false);
  });

  it("countsTowardAum stays absent on update when omitted (no default injected)", () => {
    expect(accountUpdateSchema.parse({ name: "Renamed" }).countsTowardAum).toBeUndefined();
  });

  it("loose passthrough fields are accepted but not required for non-business", () => {
    const r = accountCreateSchema.safeParse({
      ...base,
      flowMode: "annual",
      businessTaxTreatment: "qbi",
      distributionPolicyPercent: 0.5,
      hsaCoverage: "family",
      owner: "primary",
      ownerFamilyMemberId: "fm-123",
      isDefaultChecking: true,
      owners: [{ anything: true }],
    });
    expect(r.success).toBe(true);
  });

  it("hsaCoverage: null (what the form sends for non-HSA accounts) → ACCEPT", () => {
    // add-account-form sends `hsaCoverage: isHsa ? hsaCoverage : null`, so every
    // non-HSA account (Traditional IRA, brokerage, cash, …) posts null. The
    // schema must accept it or all non-HSA account creation 400s.
    const r = accountCreateSchema.safeParse({
      ...base,
      category: "retirement",
      subType: "traditional_ira",
      hsaCoverage: null,
    });
    expect(r.success).toBe(true);
  });

  it("extra unknown keys tolerated (no .strict())", () => {
    const r = accountCreateSchema.safeParse({ ...base, somethingExtra: "x" });
    expect(r.success).toBe(true);
  });
});

describe("accountUpdateSchema — truly partial (regression guard)", () => {
  it("accepts an empty patch", () => {
    expect(accountUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("injects NO ghost defaults — empty patch has 0 keys", () => {
    const d = accountUpdateSchema.parse({});
    expect(Object.keys(d).length).toBe(0);
  });

  it("omitted fields are absent (undefined), not defaulted", () => {
    const d = accountUpdateSchema.parse({});
    expect(d.value).toBeUndefined();
    expect(d.basis).toBeUndefined();
    expect(d.rothValue).toBeUndefined();
    expect(d.subType).toBeUndefined();
    expect(d.growthSource).toBeUndefined();
    expect(d.turnoverPct).toBeUndefined();
    expect(d.titlingType).toBeUndefined();
    expect(d.propertyTaxGrowthRate).toBeUndefined();
    expect(d.modelPortfolioId).toBeUndefined();
    expect(d.parentAccountId).toBeUndefined();
    expect(d.custodian).toBeUndefined();
    expect(d.rmdEnabled).toBeUndefined();
    expect(d.growthRate).toBeUndefined();
  });

  it("only name present → only name key in output", () => {
    const d = accountUpdateSchema.parse({ name: "Renamed" });
    expect(d.name).toBe("Renamed");
    expect(Object.keys(d)).toEqual(["name"]);
  });

  it("present value coerced identically to create — value: 1500 → \"1500\"", () => {
    expect(accountUpdateSchema.parse({ value: 1500 }).value).toBe("1500");
  });

  it('present decOrZero: value: "" → "0"', () => {
    expect(accountUpdateSchema.parse({ value: "" }).value).toBe("0");
  });

  it('present decOrZero: value: "2500.50" → "2500.50" (pass-through)', () => {
    expect(accountUpdateSchema.parse({ value: "2500.50" }).value).toBe("2500.50");
  });

  it("NO business superRefine on update — category business w/o businessType still parses", () => {
    expect(accountUpdateSchema.safeParse({ category: "business" }).success).toBe(true);
  });

  it("present FK uuid still validated on update", () => {
    expect(accountUpdateSchema.safeParse({ modelPortfolioId: "bad" }).success).toBe(false);
    expect(accountUpdateSchema.safeParse({ modelPortfolioId: UUID }).success).toBe(true);
  });

  it("preserves zero-keys invariant", () => {
    expect(Object.keys(accountUpdateSchema.parse({})).length).toBe(0);
  });
});
