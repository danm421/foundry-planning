// src/lib/branding/__tests__/brand-choice.test.ts
import { describe, it, expect } from "vitest";
import {
  FIRM_BRAND,
  brandAdvisorOf,
  brandChoiceSchema,
  brandChoicesFor,
  canPickBrand,
  formBrand,
  householdBrand,
  normalizeBrand,
  type BrandPicker,
} from "../brand-choice";

const FIRM = { value: FIRM_BRAND, label: "Acme Wealth (firm)" };
const JANE = { value: "user_jane", label: "Smith Wealth" };
const BOB = { value: "user_bob", label: "Bob Ray" };

describe("brand-choice", () => {
  it("names the advisor behind a brand, or none for the firm", () => {
    expect(brandAdvisorOf("firm")).toBeNull();
    expect(brandAdvisorOf("user_jane")).toBe("user_jane");
  });

  it("a household's brand is its saved choice, else its advisor", () => {
    expect(householdBrand({ brand: null, advisorId: "user_bob" })).toBe("user_bob");
    expect(householdBrand({ advisorId: "user_bob" })).toBe("user_bob");
    expect(householdBrand({ brand: "firm", advisorId: "user_bob" })).toBe("firm");
  });

  it("a form keeps its own brand; an old form falls back to the household, then its creator", () => {
    expect(formBrand({ brand: "user_jane", createdByUserId: "user_c" }, "user_bob")).toBe("user_jane");
    expect(formBrand({ brand: null, createdByUserId: "user_c" }, "user_bob")).toBe("user_bob");
    expect(formBrand({ brand: null, createdByUserId: "user_c" }, null)).toBe("user_c");
  });

  it("a brand that isn't turned on reads as the firm brand", () => {
    expect(normalizeBrand("user_jane", [FIRM, JANE])).toBe("user_jane");
    expect(normalizeBrand("user_off", [FIRM, JANE])).toBe("firm");
    expect(normalizeBrand("user_jane", [])).toBe("firm");
  });

  it("offers the picker only for two or more brands", () => {
    expect(canPickBrand({ options: [FIRM], allBrands: [FIRM] })).toBe(false);
    expect(canPickBrand({ options: [], allBrands: [] })).toBe(false);
    expect(canPickBrand({ options: [FIRM, JANE], allBrands: [FIRM, JANE] })).toBe(true);
  });

  it("adds a default the viewer couldn't pick themselves, so it still shows as selected", () => {
    const picker: BrandPicker = { options: [FIRM, JANE], allBrands: [FIRM, BOB, JANE] };
    expect(brandChoicesFor(picker, "user_jane")).toEqual([FIRM, JANE]);
    expect(brandChoicesFor(picker, "user_bob")).toEqual([FIRM, JANE, BOB]);
    expect(brandChoicesFor(picker, "user_unknown")).toEqual([FIRM, JANE]);
  });

  it("accepts a brand id and rejects junk", () => {
    expect(brandChoiceSchema.safeParse("  user_jane ").data).toBe("user_jane");
    expect(brandChoiceSchema.safeParse("").success).toBe(false);
    expect(brandChoiceSchema.safeParse(42).success).toBe(false);
    expect(brandChoiceSchema.safeParse("x".repeat(65)).success).toBe(false);
  });
});
