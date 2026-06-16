import { describe, it, expect } from "vitest";
import { liabilityCreateSchema, liabilityUpdateSchema } from "../liabilities";

describe("liabilityCreateSchema parity with inline route coercion", () => {
  const base = { name: "Mortgage", startYear: 2026, termMonths: 360 };

  it("accepts minimal required set and defaults loose fields", () => {
    const r = liabilityCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.balance).toBe("0");
      expect(r.data.interestRate).toBe("0");
      expect(r.data.monthlyPayment).toBe("0");
      expect(r.data.startMonth).toBe(1);
      expect(r.data.termUnit).toBe("annual");
      expect(r.data.isInterestDeductible).toBe(false);
      expect(r.data.linkedPropertyId).toBeNull();
      expect(r.data.startYearRef).toBeNull();
      expect(r.data.parentAccountId).toBeNull();
      expect(r.data.balanceAsOfMonth).toBeNull();
      expect(r.data.balanceAsOfYear).toBeNull();
      expect(r.data.startYear).toBe(2026);
      expect(r.data.termMonths).toBe(360);
    }
  });

  // ── decOrZero coercion for balance/interestRate/monthlyPayment ────────────

  it('balance: "" → "0"', () => {
    expect(liabilityCreateSchema.parse({ ...base, balance: "" }).balance).toBe("0");
  });

  it('balance: "  " (whitespace) → "0"', () => {
    expect(liabilityCreateSchema.parse({ ...base, balance: "  " }).balance).toBe("0");
  });

  it("balance: 1500 (number) → \"1500\"", () => {
    expect(liabilityCreateSchema.parse({ ...base, balance: 1500 }).balance).toBe("1500");
  });

  it('balance: "1500.50" (non-empty string) → "1500.50" (passes through unchanged)', () => {
    // KEY: non-empty string is NOT re-coerced — passed through verbatim
    expect(liabilityCreateSchema.parse({ ...base, balance: "1500.50" }).balance).toBe("1500.50");
  });

  it("balance absent → \"0\" on create", () => {
    expect(liabilityCreateSchema.parse(base).balance).toBe("0");
  });

  it("same decOrZero for interestRate and monthlyPayment", () => {
    expect(liabilityCreateSchema.parse({ ...base, interestRate: "" }).interestRate).toBe("0");
    expect(liabilityCreateSchema.parse({ ...base, interestRate: 0.065 }).interestRate).toBe("0.065");
    expect(liabilityCreateSchema.parse({ ...base, monthlyPayment: "2500.00" }).monthlyPayment).toBe("2500.00");
    expect(liabilityCreateSchema.parse({ ...base, monthlyPayment: null }).monthlyPayment).toBe("0");
  });

  // ── int coercions ──────────────────────────────────────────────────────────

  it('termMonths: "60" → 60', () => {
    expect(liabilityCreateSchema.parse({ ...base, termMonths: "60" }).termMonths).toBe(60);
  });

  it("startMonth absent → 1 (default)", () => {
    expect(liabilityCreateSchema.parse(base).startMonth).toBe(1);
  });

  it("balanceAsOfYear: \"2025\" → 2025", () => {
    expect(liabilityCreateSchema.parse({ ...base, balanceAsOfYear: "2025" }).balanceAsOfYear).toBe(2025);
  });

  it("balanceAsOfYear absent → null", () => {
    expect(liabilityCreateSchema.parse(base).balanceAsOfYear).toBeNull();
  });

  it('balanceAsOfMonth: "3" → 3', () => {
    expect(liabilityCreateSchema.parse({ ...base, balanceAsOfMonth: "3" }).balanceAsOfMonth).toBe(3);
  });

  it("balanceAsOfMonth absent → null", () => {
    expect(liabilityCreateSchema.parse(base).balanceAsOfMonth).toBeNull();
  });

  // ── required field enforcement ────────────────────────────────────────────

  it("missing termMonths → REJECT", () => {
    expect(liabilityCreateSchema.safeParse({ name: "Car", startYear: 2025 }).success).toBe(false);
  });

  it("missing startYear → REJECT", () => {
    expect(liabilityCreateSchema.safeParse({ name: "Car", termMonths: 60 }).success).toBe(false);
  });

  it("missing name → REJECT", () => {
    expect(liabilityCreateSchema.safeParse({ startYear: 2025, termMonths: 60 }).success).toBe(false);
  });

  it("empty name → REJECT", () => {
    expect(liabilityCreateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  // ── startYear floor ────────────────────────────────────────────────────────

  it("rejects startYear: 0", () => {
    expect(liabilityCreateSchema.safeParse({ name: "x", startYear: 0, termMonths: 60 }).success).toBe(false);
  });

  it("rejects startYear: 1899 (out of range)", () => {
    expect(liabilityCreateSchema.safeParse({ ...base, startYear: 1899 }).success).toBe(false);
  });

  it("rejects startYear: 2201 (out of range)", () => {
    expect(liabilityCreateSchema.safeParse({ ...base, startYear: 2201 }).success).toBe(false);
  });

  it('rejects startYear: "" (Number("") === 0)', () => {
    expect(liabilityCreateSchema.safeParse({ ...base, startYear: "" }).success).toBe(false);
  });

  it("accepts startYear as string year", () => {
    const r = liabilityCreateSchema.safeParse({ ...base, startYear: "2030" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.startYear).toBe(2030);
  });

  // ── owners loose pass-through ──────────────────────────────────────────────

  it("owners: [{kind, percent}] passes zod as-is (loose array)", () => {
    const r = liabilityCreateSchema.safeParse({
      ...base,
      owners: [{ kind: "person", percent: 100 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.owners).toEqual([{ kind: "person", percent: 100 }]);
    }
  });

  it("owners absent → undefined (not injected)", () => {
    const r = liabilityCreateSchema.parse(base);
    expect(r.owners).toBeUndefined();
  });
});

describe("liabilityUpdateSchema — truly partial (regression guard)", () => {
  it("accepts an empty patch", () => {
    expect(liabilityUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("injects NO ghost defaults — empty patch has 0 keys", () => {
    const d = liabilityUpdateSchema.parse({});
    expect(Object.keys(d).length).toBe(0);
  });

  it("omitted fields are absent (undefined), not defaulted", () => {
    const d = liabilityUpdateSchema.parse({});
    expect(d.balance).toBeUndefined();
    expect(d.interestRate).toBeUndefined();
    expect(d.monthlyPayment).toBeUndefined();
    expect(d.startMonth).toBeUndefined();
    expect(d.termUnit).toBeUndefined();
    expect(d.isInterestDeductible).toBeUndefined();
    expect(d.startYear).toBeUndefined();
    expect(d.termMonths).toBeUndefined();
  });

  it("only name present → only name key in output", () => {
    const d = liabilityUpdateSchema.parse({ name: "Car loan" });
    expect(d.name).toBe("Car loan");
    expect(d.balance).toBeUndefined();
    expect(d.startMonth).toBeUndefined();
  });

  it("present values are still coerced — balance: 2000 → \"2000\"", () => {
    expect(liabilityUpdateSchema.parse({ balance: 2000 }).balance).toBe("2000");
  });

  it('present decOrZero coercion: balance: "" → "0"', () => {
    expect(liabilityUpdateSchema.parse({ balance: "" }).balance).toBe("0");
  });

  it('present decOrZero coercion: balance: "1234.56" → "1234.56" (pass-through)', () => {
    expect(liabilityUpdateSchema.parse({ balance: "1234.56" }).balance).toBe("1234.56");
  });

  it("present startYear is year-floor validated in update too", () => {
    expect(liabilityUpdateSchema.safeParse({ startYear: 0 }).success).toBe(false);
    expect(liabilityUpdateSchema.safeParse({ startYear: 2031 }).success).toBe(true);
    expect(liabilityUpdateSchema.parse({ startYear: "2031" }).startYear).toBe(2031);
  });

  it("present termMonths coerced to int: \"120\" → 120", () => {
    expect(liabilityUpdateSchema.parse({ termMonths: "120" }).termMonths).toBe(120);
  });

  it("preserves zero-keys invariant after coercion fields added", () => {
    expect(Object.keys(liabilityUpdateSchema.parse({})).length).toBe(0);
  });
});
