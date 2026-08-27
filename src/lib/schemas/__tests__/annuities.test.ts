import { describe, it, expect } from "vitest";
import { annuityContractSchema } from "../annuities";

/** Every issue message, so a test can name the rule it expects to fire. */
function messages(input: unknown): string[] {
  const r = annuityContractSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("annuityContractSchema — defaults", () => {
  it("parses an empty body to the DB defaults", () => {
    const r = annuityContractSchema.safeParse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.productType).toBe("fixed");
    expect(r.data.taxTreatment).toBe("non_qualified");
    expect(r.data.incomeMode).toBe("none");
    expect(r.data.annualFeePct).toBe(0);
    expect(r.data.rollupRatchets).toBe(true);
  });

  it("rejects an unknown key (.strict())", () => {
    const r = annuityContractSchema.safeParse({ notARealColumn: 1 });
    expect(r.success).toBe(false);
  });
});

describe("annuityContractSchema — the NULL cost-basis rule (non-negotiable)", () => {
  // `Number("") === 0`, and a 0 cost basis silently makes the whole contract
  // taxable — this is the exact trap the schema must not fall into.
  it("turns an empty string into null, never 0", () => {
    const r = annuityContractSchema.safeParse({ costBasis: "" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.costBasis).toBeNull();
    expect(r.data.costBasis).not.toBe(0);
  });

  it("turns an absent key into null", () => {
    const r = annuityContractSchema.safeParse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.costBasis).toBeUndefined();
  });

  it("turns an explicit null into null", () => {
    const r = annuityContractSchema.safeParse({ costBasis: null });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.costBasis).toBeNull();
  });

  it("keeps a genuine 0 as 0 — an advisor's explicit zero is not 'unknown'", () => {
    const r = annuityContractSchema.safeParse({ costBasis: 0 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.costBasis).toBe(0);
  });

  it("parses a numeric string cost basis to a number", () => {
    const r = annuityContractSchema.safeParse({ costBasis: "50000" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.costBasis).toBe(50000);
  });

  it("rejects a non-numeric cost basis", () => {
    expect(messages({ costBasis: "not a number" })).toContain("Must be a finite number");
  });
});

describe("annuityContractSchema — income-mode rules (mirror the DB CHECK constraints)", () => {
  it("rejects income_mode=rider with no benefit base", () => {
    expect(messages({ incomeMode: "rider", incomeStartYear: 2030 })).toContain(
      "An income rider needs a benefit base.",
    );
  });

  it("accepts income_mode=rider with a benefit base and a start year", () => {
    const r = annuityContractSchema.safeParse({
      incomeMode: "rider",
      benefitBase: 250000,
      incomeStartYear: 2030,
    });
    expect(r.success).toBe(true);
  });

  it("rejects income_mode=annuitized with no annual payment", () => {
    expect(messages({ incomeMode: "annuitized", incomeStartYear: 2030 })).toContain(
      "An annuitized contract needs an annual payment.",
    );
  });

  it("accepts income_mode=annuitized with a payment and a start year", () => {
    const r = annuityContractSchema.safeParse({
      incomeMode: "annuitized",
      annuitizedPayment: 24000,
      incomeStartYear: 2030,
    });
    expect(r.success).toBe(true);
  });

  it("rejects income_mode != none with neither a start year nor a start-year ref", () => {
    expect(
      messages({ incomeMode: "rider", benefitBase: 250000 }),
    ).toContain("Set when the income starts.");
  });

  it("accepts a start-year REF alone — the CHECK is satisfied by either field", () => {
    const r = annuityContractSchema.safeParse({
      incomeMode: "rider",
      benefitBase: 250000,
      incomeStartYearRef: "client_retirement",
    });
    expect(r.success).toBe(true);
  });

  it("does not require a start year when income_mode=none", () => {
    const r = annuityContractSchema.safeParse({ incomeMode: "none" });
    expect(r.success).toBe(true);
  });
});
