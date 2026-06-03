import { describe, it, expect } from "vitest";
import { PRESENTATION_THEME } from "../theme";
import { colorsLight, dataLight } from "@/brand";

describe("PRESENTATION_THEME", () => {
  it("derives its base palette from the brand light theme", () => {
    expect(PRESENTATION_THEME.paper).toBe(colorsLight.paper);
    expect(PRESENTATION_THEME.accent).toBe(colorsLight.accent);
    expect(PRESENTATION_THEME.good).toBe(colorsLight.good);
    expect(PRESENTATION_THEME.crit).toBe(colorsLight.crit);
  });

  it("maps steel to the brand data blue and keeps amber-harmonized tints", () => {
    expect(PRESENTATION_THEME.steel).toBe(dataLight.blue);
    expect(PRESENTATION_THEME.accentMuted).toBe("#e3a857");
    expect(PRESENTATION_THEME.accentTint).toBe("#f8e9cf");
  });

  it("defines the cash-flow chart palette in stack-render order (Deep Jewel light)", () => {
    expect(PRESENTATION_THEME.chartStack).toEqual([
      dataLight.blue,   // social security
      dataLight.green,  // salaries
      dataLight.teal,   // other inflows
      dataLight.orange, // rmds
      dataLight.red,    // withdrawals
    ]);
    expect(PRESENTATION_THEME.chartLine).toBe(colorsLight.ink);
  });
});
