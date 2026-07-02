import { describe, it, expect } from "vitest";
import { incomeCreateSchema, incomeUpdateSchema } from "../incomes";

describe("incomeCreateSchema parity with inline route coercion", () => {
  const base = { type: "salary", name: "W-2 Income", startYear: 2026, endYear: 2060 };

  it("accepts the minimal required set and defaults the loose fields", () => {
    const r = incomeCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.annualAmount).toBe("0");      // ?? "0"
      expect(r.data.growthRate).toBe("0.03");     // ?? "0.03"
      expect(r.data.growthSource).toBe("custom"); // non-"inflation" → custom
      expect(r.data.owner).toBe("client");        // ?? "client"
      expect(r.data.startYear).toBe(2026);        // Number()
      expect(r.data.claimingAge).toBeNull();      // absent → null
      expect(r.data.claimingAgeMonths).toBe(0);   // absent → 0
      expect(r.data.piaMonthly).toBeNull();       // absent → null
    }
  });

  it("coerces numeric-string years like Number(startYear)", () => {
    const r = incomeCreateSchema.safeParse({ ...base, startYear: "2030", endYear: "2061" });
    expect(r.success && r.data.startYear).toBe(2030);
    expect(r.success && r.data.endYear).toBe(2061);
  });

  it('maps growthSource "inflation" through, everything else → "custom"', () => {
    expect((incomeCreateSchema.parse({ ...base, growthSource: "inflation" })).growthSource).toBe("inflation");
    expect((incomeCreateSchema.parse({ ...base, growthSource: "wibble" })).growthSource).toBe("custom");
  });

  it("rejects missing required fields (type/name/startYear/endYear)", () => {
    expect(incomeCreateSchema.safeParse({ name: "x", startYear: 2026, endYear: 2060 }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ type: "salary", startYear: 2026, endYear: 2060 }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ type: "salary", name: "x", endYear: 2060 }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ type: "salary", name: "x", startYear: 2026 }).success).toBe(false);
  });

  it("rejects year 0 (startYear and endYear)", () => {
    expect(incomeCreateSchema.safeParse({ ...base, startYear: 0 }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ ...base, endYear: 0 }).success).toBe(false);
  });

  it('rejects empty string years (Number("") === 0)', () => {
    expect(incomeCreateSchema.safeParse({ ...base, startYear: "" }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ ...base, endYear: "" }).success).toBe(false);
  });

  it("rejects out-of-range years (below 1900, above 2200)", () => {
    expect(incomeCreateSchema.safeParse({ ...base, startYear: 1899 }).success).toBe(false);
    expect(incomeCreateSchema.safeParse({ ...base, startYear: 2300 }).success).toBe(false);
  });

  it("rejects both ownerEntityId and ownerAccountId set (the route's both-owner 400)", () => {
    const r = incomeCreateSchema.safeParse({
      ...base,
      ownerEntityId: "11111111-1111-1111-1111-111111111111",
      ownerAccountId: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(false);
  });

  // --- income-specific field coercions ---

  it('defaults owner to "client" when absent', () => {
    const r = incomeCreateSchema.parse(base);
    expect(r.owner).toBe("client");
  });

  it('passes through owner: "spouse"', () => {
    const r = incomeCreateSchema.parse({ ...base, owner: "spouse" });
    expect(r.owner).toBe("spouse");
  });

  it('coerces claimingAge string "62" → 62', () => {
    const r = incomeCreateSchema.parse({ ...base, claimingAge: "62" });
    expect(r.claimingAge).toBe(62);
  });

  it("produces claimingAge: null when absent (falsy default)", () => {
    const r = incomeCreateSchema.parse(base);
    expect(r.claimingAge).toBeNull();
  });

  it("coerces claimingAgeMonths string to number", () => {
    const r = incomeCreateSchema.parse({ ...base, claimingAgeMonths: "6" });
    expect(r.claimingAgeMonths).toBe(6);
  });

  it("defaults claimingAgeMonths to 0 when absent", () => {
    const r = incomeCreateSchema.parse(base);
    expect(r.claimingAgeMonths).toBe(0);
  });

  it("coerces piaMonthly number → string", () => {
    const r = incomeCreateSchema.parse({ ...base, piaMonthly: 2400 });
    expect(r.piaMonthly).toBe("2400");
  });

  it("produces piaMonthly: null when absent", () => {
    const r = incomeCreateSchema.parse(base);
    expect(r.piaMonthly).toBeNull();
  });

  it("accepts taxType as nullable string", () => {
    expect(incomeCreateSchema.parse({ ...base, taxType: "ordinary" }).taxType).toBe("ordinary");
    expect(incomeCreateSchema.parse({ ...base, taxType: null }).taxType).toBeNull();
    expect(incomeCreateSchema.parse(base).taxType).toBeNull();
  });

  it("accepts ssBenefitMode as nullable string", () => {
    expect(incomeCreateSchema.parse({ ...base, ssBenefitMode: "reduced" }).ssBenefitMode).toBe("reduced");
    expect(incomeCreateSchema.parse(base).ssBenefitMode).toBeNull();
  });

  it("accepts claimingAgeMode as nullable string", () => {
    expect(incomeCreateSchema.parse({ ...base, claimingAgeMode: "manual" }).claimingAgeMode).toBe("manual");
    expect(incomeCreateSchema.parse(base).claimingAgeMode).toBeNull();
  });
});

describe("incomeUpdateSchema", () => {
  it("is fully partial — accepts an empty patch", () => {
    expect(incomeUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("injects NO ghost defaults for an empty patch (truly partial)", () => {
    const d = incomeUpdateSchema.parse({});
    // Strict: no keys at all (catches ghost keys even if undefined-valued).
    expect(Object.keys(d).length).toBe(0);
    expect(d.annualAmount).toBeUndefined();
    expect(d.growthRate).toBeUndefined();
    expect(d.growthSource).toBeUndefined();
    expect(d.startYear).toBeUndefined();
    expect(d.endYear).toBeUndefined();
    expect(d.owner).toBeUndefined();
    expect(d.claimingAge).toBeUndefined();
    expect(d.claimingAgeMonths).toBeUndefined();
    expect(d.piaMonthly).toBeUndefined();
  });

  it("leaves omitted loose fields undefined when only name is patched", () => {
    const d = incomeUpdateSchema.parse({ name: "Pension" });
    expect(Object.keys(d).length).toBe(1);
    expect(d.name).toBe("Pension");
    expect(d.annualAmount).toBeUndefined();
    expect(d.growthRate).toBeUndefined();
    expect(d.owner).toBeUndefined();
    expect(d.claimingAge).toBeUndefined();
    expect(d.claimingAgeMonths).toBeUndefined();
  });

  it("still coerces present values identically to create", () => {
    expect(incomeUpdateSchema.parse({ annualAmount: 1500 }).annualAmount).toBe("1500");
    expect(incomeUpdateSchema.parse({ startYear: "2031" }).startYear).toBe(2031);
    expect(incomeUpdateSchema.parse({ growthSource: "inflation" }).growthSource).toBe("inflation");
    expect(incomeUpdateSchema.parse({ growthSource: "wibble" }).growthSource).toBe("custom");
  });

  it("rejects year 0 in a patch (startYear: 0)", () => {
    expect(incomeUpdateSchema.safeParse({ startYear: 0 }).success).toBe(false);
    expect(incomeUpdateSchema.safeParse({ endYear: 0 }).success).toBe(false);
  });

  it("accepts a valid string year in a patch and coerces to number", () => {
    const r = incomeUpdateSchema.safeParse({ startYear: "2031" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.startYear).toBe(2031);
  });

  it("preserves the empty-patch zero-keys invariant after year field additions", () => {
    const d = incomeUpdateSchema.parse({});
    expect(Object.keys(d).length).toBe(0);
  });

  it("still enforces the both-owner refine when those fields are present", () => {
    expect(incomeUpdateSchema.safeParse({
      ownerEntityId: "11111111-1111-1111-1111-111111111111",
      ownerAccountId: "22222222-2222-2222-2222-222222222222",
    }).success).toBe(false);
  });

  // --- income-specific update coercions ---

  it('coerces claimingAge: "63" → 63 in a patch', () => {
    const d = incomeUpdateSchema.parse({ claimingAge: "63" });
    expect(d.claimingAge).toBe(63);
  });

  it("coerces claimingAgeMonths: \"6\" → 6 in a patch", () => {
    const d = incomeUpdateSchema.parse({ claimingAgeMonths: "6" });
    expect(d.claimingAgeMonths).toBe(6);
  });

  it("coerces piaMonthly: 3000 → \"3000\" in a patch", () => {
    const d = incomeUpdateSchema.parse({ piaMonthly: 3000 });
    expect(d.piaMonthly).toBe("3000");
  });

  it("passes claimingAgeMonths: null → 0 in a patch (route: != null ? Number : 0)", () => {
    const d = incomeUpdateSchema.parse({ claimingAgeMonths: null });
    expect(d.claimingAgeMonths).toBe(0);
  });

  it("passes piaMonthly: null → null in a patch", () => {
    const d = incomeUpdateSchema.parse({ piaMonthly: null });
    expect(d.piaMonthly).toBeNull();
  });
});

describe("incomeCreateSchema linkedPropertyId", () => {
  const base = { type: "other", name: "Rental", startYear: 2026, endYear: 2055 };
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts linkedPropertyId on an 'other' income", () => {
    const r = incomeCreateSchema.safeParse({ ...base, linkedPropertyId: uuid });
    expect(r.success).toBe(true);
  });

  it("rejects linkedPropertyId together with ownerEntityId", () => {
    const r = incomeCreateSchema.safeParse({ ...base, linkedPropertyId: uuid, ownerEntityId: uuid });
    expect(r.success).toBe(false);
  });

  it("rejects linkedPropertyId together with ownerAccountId", () => {
    const r = incomeCreateSchema.safeParse({ ...base, linkedPropertyId: uuid, ownerAccountId: uuid });
    expect(r.success).toBe(false);
  });

  it("rejects linkedPropertyId when type is not 'other'", () => {
    const r = incomeCreateSchema.safeParse({ ...base, type: "salary", linkedPropertyId: uuid });
    expect(r.success).toBe(false);
  });
});

describe("survivorshipPct", () => {
  it("accepts a fractional survivorship on create", () => {
    const parsed = incomeCreateSchema.parse({
      type: "deferred", name: "Pension", annualAmount: "50000",
      startYear: 2027, endYear: 2068, survivorshipPct: "0.5",
    });
    expect(parsed.survivorshipPct).toBe("0.5");
  });
  it("rejects survivorship above 1", () => {
    expect(() => incomeCreateSchema.parse({
      type: "deferred", name: "Pension", annualAmount: "50000",
      startYear: 2027, endYear: 2068, survivorshipPct: "1.5",
    })).toThrow();
  });
  it("leaves survivorshipPct undefined when omitted on update", () => {
    const parsed = incomeUpdateSchema.parse({ name: "x" });
    expect("survivorshipPct" in parsed).toBe(false);
  });
});
