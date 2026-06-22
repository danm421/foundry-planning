import { describe, it, expect } from "vitest";
import {
  isPortalVisibleAccount,
  isPortalVisibleCategory,
  PORTAL_VISIBLE_CATEGORIES,
} from "@/lib/portal/account-visibility";

const base = { category: "cash", isDefaultChecking: false, parentAccountId: null };

describe("isPortalVisibleCategory", () => {
  it("accepts the four visible categories", () => {
    for (const c of PORTAL_VISIBLE_CATEGORIES) {
      expect(isPortalVisibleCategory(c)).toBe(true);
    }
  });
  it("rejects advisor-only categories", () => {
    for (const c of [
      "business",
      "annuity",
      "life_insurance",
      "notes_receivable",
      "stock_options",
    ]) {
      expect(isPortalVisibleCategory(c)).toBe(false);
    }
  });
});

describe("isPortalVisibleAccount", () => {
  it("shows real cash / taxable / retirement / real_estate accounts", () => {
    expect(isPortalVisibleAccount(base)).toBe(true);
    expect(isPortalVisibleAccount({ ...base, category: "taxable" })).toBe(true);
    expect(isPortalVisibleAccount({ ...base, category: "retirement" })).toBe(true);
    expect(isPortalVisibleAccount({ ...base, category: "real_estate" })).toBe(true);
  });
  it("hides the engine cash-flow bucket (isDefaultChecking)", () => {
    expect(isPortalVisibleAccount({ ...base, isDefaultChecking: true })).toBe(false);
  });
  it("hides business sub-accounts (parentAccountId set)", () => {
    expect(
      isPortalVisibleAccount({ ...base, category: "real_estate", parentAccountId: "acct-parent" }),
    ).toBe(false);
  });
  it("hides advisor-only categories even when otherwise normal", () => {
    expect(isPortalVisibleAccount({ ...base, category: "notes_receivable" })).toBe(false);
    expect(isPortalVisibleAccount({ ...base, category: "life_insurance" })).toBe(false);
    expect(isPortalVisibleAccount({ ...base, category: "business" })).toBe(false);
  });
});
