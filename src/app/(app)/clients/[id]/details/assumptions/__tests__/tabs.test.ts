import { describe, it, expect } from "vitest";
import {
  ASSUMPTIONS_TABS,
  DEFAULT_ASSUMPTIONS_TAB,
  assumptionsTabQuery,
  resolveAssumptionsTab,
} from "../tabs";

describe("resolveAssumptionsTab", () => {
  it("accepts every id the tab bar renders", () => {
    for (const t of ASSUMPTIONS_TABS) {
      expect(resolveAssumptionsTab(t.id)).toBe(t.id);
    }
  });

  it("resolves the deep-link the risk card emits", () => {
    expect(resolveAssumptionsTab("growth-inflation")).toBe("growth-inflation");
  });

  it("falls back to the default on a missing or unrecognised value", () => {
    expect(resolveAssumptionsTab(null)).toBe(DEFAULT_ASSUMPTIONS_TAB);
    expect(resolveAssumptionsTab(undefined)).toBe(DEFAULT_ASSUMPTIONS_TAB);
    expect(resolveAssumptionsTab("")).toBe(DEFAULT_ASSUMPTIONS_TAB);
    expect(resolveAssumptionsTab("not-a-tab")).toBe(DEFAULT_ASSUMPTIONS_TAB);
  });

  it("defaults to Tax Rates, the tab the page opened on before deep-linking", () => {
    expect(DEFAULT_ASSUMPTIONS_TAB).toBe("tax-rates");
  });
});

describe("assumptionsTabQuery", () => {
  it("preserves the scenario param across a tab switch", () => {
    const q = assumptionsTabQuery(new URLSearchParams("scenario=sc-1"), "deductions");
    const parsed = new URLSearchParams(q);
    expect(parsed.get("scenario")).toBe("sc-1");
    expect(parsed.get("tab")).toBe("deductions");
  });

  it("replaces an existing tab param rather than appending a second one", () => {
    const q = assumptionsTabQuery(new URLSearchParams("tab=growth-inflation"), "withdrawal");
    expect(new URLSearchParams(q).getAll("tab")).toEqual(["withdrawal"]);
  });

  it("returns a leading-? query string, ready for pushState", () => {
    expect(assumptionsTabQuery(new URLSearchParams(), "tax-rates").startsWith("?")).toBe(true);
  });
});
