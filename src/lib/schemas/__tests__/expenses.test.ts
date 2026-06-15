import { describe, it, expect } from "vitest";
import { expenseCreateSchema, expenseUpdateSchema } from "../expenses";

describe("expenseCreateSchema parity with inline route coercion", () => {
  const base = { type: "living", name: "Groceries", startYear: 2026, endYear: 2060 };

  it("accepts the minimal required set and defaults the loose fields", () => {
    const r = expenseCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.annualAmount).toBe("0");        // ?? "0"
      expect(r.data.growthRate).toBe("0.03");       // ?? "0.03"
      expect(r.data.growthSource).toBe("custom");   // non-"inflation" → custom
      expect(r.data.startYear).toBe(2026);          // Number()
    }
  });

  it("coerces numeric-string years like Number(startYear)", () => {
    const r = expenseCreateSchema.safeParse({ ...base, startYear: "2030", endYear: "2061" });
    expect(r.success && r.data.startYear).toBe(2030);
    expect(r.success && r.data.endYear).toBe(2061);
  });

  it('maps growthSource "inflation" through, everything else → "custom"', () => {
    expect((expenseCreateSchema.parse({ ...base, growthSource: "inflation" })).growthSource).toBe("inflation");
    expect((expenseCreateSchema.parse({ ...base, growthSource: "wibble" })).growthSource).toBe("custom");
  });

  it("rejects missing required fields (type/name/startYear/endYear)", () => {
    expect(expenseCreateSchema.safeParse({ name: "x", startYear: 1, endYear: 2 }).success).toBe(false);
  });

  it("rejects year 0 (startYear and endYear)", () => {
    expect(expenseCreateSchema.safeParse({ ...base, startYear: 0 }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, endYear: 0 }).success).toBe(false);
  });

  it('rejects empty string years (Number("") === 0)', () => {
    expect(expenseCreateSchema.safeParse({ ...base, startYear: "" }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, endYear: "" }).success).toBe(false);
  });

  it("rejects out-of-range years (below 1900, above 2200)", () => {
    expect(expenseCreateSchema.safeParse({ ...base, startYear: 1899 }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, startYear: 2300 }).success).toBe(false);
  });

  it("enforces endsAtMedicareEligibilityOwner ∈ {client, spouse, null}", () => {
    expect(expenseCreateSchema.safeParse({ ...base, endsAtMedicareEligibilityOwner: "child" }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, endsAtMedicareEligibilityOwner: "spouse" }).success).toBe(true);
    expect(expenseCreateSchema.safeParse({ ...base, endsAtMedicareEligibilityOwner: null }).success).toBe(true);
  });

  it("rejects both ownerEntityId and ownerAccountId set (the route's both-owner 400)", () => {
    const r = expenseCreateSchema.safeParse({
      ...base, ownerEntityId: "11111111-1111-1111-1111-111111111111", ownerAccountId: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(false);
  });
});

describe("expenseUpdateSchema", () => {
  it("is fully partial — accepts an empty patch", () => {
    expect(expenseUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("injects NO ghost defaults for an empty patch (truly partial)", () => {
    const d = expenseUpdateSchema.parse({});
    // Strict: no keys at all (catches ghost keys even if undefined-valued).
    expect(Object.keys(d).length).toBe(0);
    expect(d.annualAmount).toBeUndefined();
    expect(d.growthRate).toBeUndefined();
    expect(d.growthSource).toBeUndefined();
    expect(d.startYear).toBeUndefined();
    expect(d.endYear).toBeUndefined();
  });

  it("leaves omitted loose fields undefined when only name is patched", () => {
    const d = expenseUpdateSchema.parse({ name: "Rent" });
    expect(d.name).toBe("Rent");
    expect(d.annualAmount).toBeUndefined();
    expect(d.growthRate).toBeUndefined();
    expect(d.growthSource).toBeUndefined();
  });

  it("still coerces present values identically to create", () => {
    expect(expenseUpdateSchema.parse({ annualAmount: 1500 }).annualAmount).toBe("1500");
    expect(expenseUpdateSchema.parse({ startYear: "2031" }).startYear).toBe(2031);
    expect(expenseUpdateSchema.parse({ growthSource: "inflation" }).growthSource).toBe("inflation");
    expect(expenseUpdateSchema.parse({ growthSource: "wibble" }).growthSource).toBe("custom");
  });

  it("rejects year 0 in a patch (startYear: 0)", () => {
    expect(expenseUpdateSchema.safeParse({ startYear: 0 }).success).toBe(false);
    expect(expenseUpdateSchema.safeParse({ endYear: 0 }).success).toBe(false);
  });

  it("accepts a valid string year in a patch and coerces to number", () => {
    const r = expenseUpdateSchema.safeParse({ startYear: "2031" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.startYear).toBe(2031);
  });

  it("preserves the empty-patch zero-keys invariant after year field additions", () => {
    const d = expenseUpdateSchema.parse({});
    expect(Object.keys(d).length).toBe(0);
  });

  it("still enforces the medicare enum and both-owner refine when those fields are present", () => {
    expect(expenseUpdateSchema.safeParse({ endsAtMedicareEligibilityOwner: "nope" }).success).toBe(false);
    expect(expenseUpdateSchema.safeParse({
      ownerEntityId: "11111111-1111-1111-1111-111111111111", ownerAccountId: "22222222-2222-2222-2222-222222222222",
    }).success).toBe(false);
  });
});
