import { describe, it, expect } from "vitest";
import { mapPfcToSlug, pfcToType } from "@/lib/portal/pfc-mapping";
import { DEFAULT_LEAF_SLUGS } from "@/lib/portal/default-categories";

const PFC_PRIMARIES = [
  "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES",
  "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "HOME_IMPROVEMENT",
  "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES",
];

describe("mapPfcToSlug", () => {
  it("maps every PFC v2 primary to a real seeded leaf slug", () => {
    for (const p of PFC_PRIMARIES) {
      const slug = mapPfcToSlug(p, null);
      expect(slug, p).not.toBeNull();
      expect(DEFAULT_LEAF_SLUGS.has(slug!), `${p} -> ${slug}`).toBe(true);
    }
  });
  it("returns null for unknown primary", () => {
    expect(mapPfcToSlug("WHO_KNOWS", null)).toBeNull();
    expect(mapPfcToSlug(null, null)).toBeNull();
  });
  it("detailed override: groceries beats the FOOD_AND_DRINK primary", () => {
    expect(mapPfcToSlug("FOOD_AND_DRINK", null)).toBe("food-restaurants");
    expect(mapPfcToSlug("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")).toBe("food-groceries");
  });
  it("detailed override: gas beats the TRANSPORTATION primary", () => {
    expect(mapPfcToSlug("TRANSPORTATION", "TRANSPORTATION_GAS")).toBe("transport-gas");
  });
  it("detailed override: rent/mortgage beats RENT_AND_UTILITIES", () => {
    expect(mapPfcToSlug("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")).toBe("household-mortgage");
    expect(mapPfcToSlug("RENT_AND_UTILITIES", null)).toBe("household-utilities");
  });
});

describe("pfcToType", () => {
  it("maps INCOME → income", () => {
    expect(pfcToType("INCOME")).toBe("income");
  });
  it("maps TRANSFER_IN and TRANSFER_OUT → transfer", () => {
    expect(pfcToType("TRANSFER_IN")).toBe("transfer");
    expect(pfcToType("TRANSFER_OUT")).toBe("transfer");
  });
  it("maps any other primary or null → expense", () => {
    expect(pfcToType("FOOD_AND_DRINK")).toBe("expense");
    expect(pfcToType("LOAN_PAYMENTS")).toBe("expense"); // card payments default to expense
    expect(pfcToType(null)).toBe("expense");
  });
});
