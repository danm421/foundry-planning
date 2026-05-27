import { describe, it, expect } from "vitest";
import { PRESENTATION_THEME } from "../theme";

describe("PRESENTATION_THEME", () => {
  it("re-exports Foundry's base palette", () => {
    expect(PRESENTATION_THEME.paper).toBe("#f6f3ec");
    expect(PRESENTATION_THEME.accent).toBe("#b87f1f");
    expect(PRESENTATION_THEME.good).toBe("#2f6b4a");
    expect(PRESENTATION_THEME.crit).toBe("#a13a3a");
  });

  it("adds the three new presentation tokens", () => {
    expect(PRESENTATION_THEME.steel).toBe("#3b6ea3");
    expect(PRESENTATION_THEME.accentMuted).toBe("#d4a86a");
    expect(PRESENTATION_THEME.accentTint).toBe("#f4e6c8");
  });

  it("defines the cash-flow chart palette in stack-render order", () => {
    expect(PRESENTATION_THEME.chartStack).toEqual([
      "#3b6ea3", // salary
      "#b87f1f", // social security
      "#2f6b4a", // other income
      "#d4a86a", // rmd
      "#5a5a60", // discretionary withdrawals
    ]);
    expect(PRESENTATION_THEME.chartLine).toBe("#a13a3a"); // total expenses
  });
});
