import { describe, it, expect } from "vitest";
import { COMPARISON_WIDGETS } from "../registry";
import { WIDGET_KINDS } from "../../layout-schema";

const VALID_CATEGORIES = [
  "kpis",
  "cashflow",
  "investments",
  "monte-carlo",
  "retirement-income",
  "tax",
  "estate",
  "text",
] as const;

const VALID_SCENARIOS = ["none", "one", "one-or-many", "many-only"] as const;

describe("widget contract — category + scenarios + defaultPlanCount", () => {
  it("every widget declares a valid category", () => {
    for (const kind of WIDGET_KINDS) {
      const def = COMPARISON_WIDGETS[kind];
      expect(
        VALID_CATEGORIES.includes(def.category),
        `widget ${kind} has invalid category ${def.category}`,
      ).toBe(true);
    }
  });

  it("every widget declares valid scenarios cardinality", () => {
    for (const kind of WIDGET_KINDS) {
      const def = COMPARISON_WIDGETS[kind];
      expect(VALID_SCENARIOS.includes(def.scenarios)).toBe(true);
    }
  });

  it("specific categorizations from spec", () => {
    // KPIs
    // (kpi added in Task 3)

    // Cash Flow
    expect(COMPARISON_WIDGETS["income-expense"].category).toBe("cashflow");
    expect(COMPARISON_WIDGETS["withdrawal-source"].category).toBe("cashflow");
    expect(COMPARISON_WIDGETS["year-by-year"].category).toBe("cashflow");
    expect(COMPARISON_WIDGETS["cash-flow-gap"].category).toBe("cashflow");
    expect(COMPARISON_WIDGETS["decade-summary"].category).toBe("cashflow");
    expect(COMPARISON_WIDGETS["liquidity"].category).toBe("cashflow");

    // Investments
    expect(COMPARISON_WIDGETS["allocation-drift"].category).toBe("investments");
    expect(COMPARISON_WIDGETS["portfolio"].category).toBe("investments");

    // Monte Carlo
    expect(COMPARISON_WIDGETS["monte-carlo"].category).toBe("monte-carlo");
    expect(COMPARISON_WIDGETS["longevity"].category).toBe("monte-carlo");

    // Retirement Income
    expect(COMPARISON_WIDGETS["ss-income"].category).toBe("retirement-income");
    expect(COMPARISON_WIDGETS["rmd-schedule"].category).toBe("retirement-income");

    // Tax
    expect(COMPARISON_WIDGETS["tax-bracket-fill"].category).toBe("tax");
    expect(COMPARISON_WIDGETS["roth-ladder"].category).toBe("tax");
    expect(COMPARISON_WIDGETS["lifetime-tax"].category).toBe("tax");

    // Estate
    expect(COMPARISON_WIDGETS["charitable-impact"].category).toBe("estate");
    expect(COMPARISON_WIDGETS["estate-impact"].category).toBe("estate");
    expect(COMPARISON_WIDGETS["estate-tax"].category).toBe("estate");

    // Text
    expect(COMPARISON_WIDGETS["text"].category).toBe("text");
  });

  it("specific cardinality from spec", () => {
    expect(COMPARISON_WIDGETS["text"].scenarios).toBe("none");
    expect(COMPARISON_WIDGETS["year-by-year"].scenarios).toBe("many-only");
    // every non-text non-year-by-year existing widget is one-or-many
    for (const kind of WIDGET_KINDS) {
      if (kind === "text" || kind === "year-by-year") continue;
      expect(COMPARISON_WIDGETS[kind].scenarios).toBe("one-or-many");
    }
  });

  it("kpi-strip still classified (legacy widget kept until Plan 2 migration)", () => {
    expect(COMPARISON_WIDGETS["kpi-strip"].category).toBe("kpis");
  });
});
