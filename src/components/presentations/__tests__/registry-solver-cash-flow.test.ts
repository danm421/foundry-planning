import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("the Solver's Cash Flow reports as deck pages", () => {
  it("registers Withdrawals under Cash Flow", () => {
    const page = PRESENTATION_PAGES.cashFlowWithdrawals;
    expect(page.id).toBe("cashFlowWithdrawals");
    expect(page.title).toBe("Withdrawals");
    expect(page.category).toBe("Cash Flow");
    expect(page.supportsScenarioOverride).toBe(true);
    expect(typeof page.OptionsControl).toBe("function");
  });

  it("registers Monthly Cash Flow under Cash Flow", () => {
    const page = PRESENTATION_PAGES.cashFlowMonthly;
    expect(page.id).toBe("cashFlowMonthly");
    expect(page.title).toBe("Monthly Cash Flow");
    expect(page.category).toBe("Cash Flow");
    expect(page.supportsScenarioOverride).toBe(true);
    expect(typeof page.OptionsControl).toBe("function");
  });

  it("opens Monthly on the across-the-plan table in today's dollars", () => {
    expect(PRESENTATION_PAGES.cashFlowMonthly.defaultOptions).toEqual({
      view: "plan",
      basis: "today",
      range: "full",
      year: null,
    });
  });

  it("round-trips every Monthly option through the persisted schema", () => {
    // A template saves these options to the database and re-parses them on
    // load. A field the schema drops comes back as its default, silently
    // re-pointing a saved sheet at a different table or year.
    const page = PRESENTATION_PAGES.cashFlowMonthly;
    const saved = {
      view: "months" as const,
      basis: "nominal" as const,
      range: { startYear: 2041, endYear: 2050 },
      year: 2044,
    };
    expect(page.optionsSchema.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("names the view, the year rule and the basis in the launcher summary", () => {
    const page = PRESENTATION_PAGES.cashFlowMonthly;
    expect(page.summarizeOptions({ view: "plan", basis: "today", range: "full", year: null }))
      .toBe("Across the plan · Full range · Today's dollars");
    // The year is resolved against the projection at build time, which the
    // launcher has not run — so it names the rule rather than guessing a year.
    expect(page.summarizeOptions({ view: "months", basis: "nominal", range: "full", year: null }))
      .toBe("Month by month · first shortfall year · Future dollars");
    expect(page.summarizeOptions({ view: "months", basis: "today", range: "full", year: 2044 }))
      .toBe("Month by month · 2044 · Today's dollars");
  });
});
