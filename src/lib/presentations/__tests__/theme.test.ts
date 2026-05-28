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
      "#2563eb", // social security
      "#16a34a", // salaries
      "#99f6e4", // other inflows
      "#f97316", // rmds
      "#ef4444", // withdrawals
    ]);
    expect(PRESENTATION_THEME.chartLine).toBe("#1a1a1d"); // total expenses
  });
});
