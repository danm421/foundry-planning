import { describe, it, expect } from "vitest";
import { buildTaxBracketFederalDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
};

describe("buildTaxBracketFederalDrillData", () => {
  it("maps bracket-stacking columns from buildTaxBracketRows", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "full", showCallout: false } });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    // incomeTaxBase 384_200 sits in the 24% tier [383_900, 487_450].
    expect(r.cells.incomeTaxBase).toBe(384_200);
    expect(r.cells.marginalRate).toBeCloseTo(0.24);
    expect(r.cells.intoBracket).toBe(300);          // 384_200 - 383_900
    expect(r.cells.remainingInBracket).toBe(103_250); // 487_450 - 384_200
    expect(d.chartSpec).toBeDefined();
    expect(d.table.columns.find((c) => c.key === "changeInBase")!.signColor).toBe(true);
  });

  it("emits an Into/Remaining bracket-fill chart with a conversion line", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "full", showCallout: false } });
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual(["intoBracket", "remainingInBracket"]);
    expect(d.chartSpec!.lines.map((l) => l.seriesId)).toEqual(["conversionTaxable"]);
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const into = d.chartSpec!.stacks.find((s) => s.seriesId === "intoBracket")!;
    const remaining = d.chartSpec!.stacks.find((s) => s.seriesId === "remainingInBracket")!;
    expect(into.values[i]).toBe(300);          // 384_200 - 383_900
    expect(remaining.values[i]).toBe(103_250); // 487_450 - 384_200
  });

  it("first visible year has changeInBase 0; later years show the delta", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "full", showCallout: false } });
    expect(d.table.rows[0].cells.changeInBase).toBe(0);
  });
});

// ── F5 — this page prints "Marginal Rate" and "Remaining in Bracket" directly
// beside a "Roth Conversion" column, in a document the client keeps. In a year
// AMT binds, both of those are claims about a rate that does not apply.
describe("buildTaxBracketFederalDrillData — AMT years (F5)", () => {
  function yearsWithAmt() {
    const years = makeTaxYears();
    const y2026 = years.find((y) => y.year === 2026)!;
    y2026.taxResult!.flow.amtAdditional = 208_800;
    (y2026.taxResult!.diag as { nextDollarFederalRate?: number }).nextDollarFederalRate = 0.42;
    return years;
  }

  it("prints no bracket headroom for a year AMT binds", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsWithAmt(), options: { range: "full", showCallout: false },
    });
    expect(d.table.rows.find((r) => r.year === 2026)!.cells.remainingInBracket).toBe(0);
  });

  it("says so in the footnote, naming the year", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsWithAmt(), options: { range: "full", showCallout: false },
    });
    expect(d.footnote).toContain("AMT");
    expect(d.footnote).toContain("2026");
  });

  it("leaves the footnote alone when no year has AMT", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, options: { range: "full", showCallout: false },
    });
    expect(d.footnote).not.toContain("AMT");
  });

  it("drops the headroom band out of the chart too, so the bar cannot claim room", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsWithAmt(), options: { range: "full", showCallout: false },
    });
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    expect(d.chartSpec!.stacks.find((s) => s.seriesId === "remainingInBracket")!.values[i]).toBe(0);
  });

  it("keeps the ordinary years' headroom intact", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsWithAmt(), options: { range: "full", showCallout: false },
    });
    const other = d.table.rows.find((r) => r.year !== 2026);
    if (other) expect(other.cells.remainingInBracket).toBeGreaterThan(0);
  });
});

describe("buildTaxBracketFederalDrillData — the footnote cannot run off the page", () => {
  it("caps the year list and says how many it left out", () => {
    const years = makeTaxYears();
    // Every year in the fixture binds on AMT.
    for (const y of years) y.taxResult!.flow.amtAdditional = 100_000;
    const d = buildTaxBracketFederalDrillData({
      ...base, years, options: { range: "full", showCallout: false },
    });
    const named = (d.footnote.match(/20\d\d/g) ?? []).length;
    expect(named).toBeLessThanOrEqual(6);
    if (years.length > 6) expect(d.footnote).toContain("more");
  });
});

describe("buildTaxBracketFederalDrillData — Roth conversion years", () => {
  const rothOnly = { range: "rothConversionYears" as const, showCallout: false };

  function yearsConvertingIn2036() {
    const years = makeTaxYears();
    years.find((y) => y.year === 2036)!.rothConversions = [
      { id: "rc1", name: "Fill the 12% bracket", gross: 40_000, taxable: 40_000 },
    ];
    return years;
  }

  it("keeps only the years a conversion happens, in the table and the chart", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, years: yearsConvertingIn2036(), options: rothOnly });
    expect(d.table.rows.map((r) => r.year)).toEqual([2036]);
    expect(d.table.rows[0].cells.conversionGross).toBe(40_000);
    expect(d.chartSpec!.xAxis.domain).toEqual([2036]);
  });

  it("reports Change in Base against the prior year even though the range hides it", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, years: yearsConvertingIn2036(), options: rothOnly });
    // 2036 base 63_800 less 2031 base 50_800 — the hidden year, not a zero.
    expect(d.table.rows[0].cells.changeInBase).toBe(13_000);
  });

  it("says so, and prints no chart, when the plan has no conversions", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: rothOnly });
    expect(d.table.rows).toHaveLength(0);
    expect(d.chartSpec).toBeUndefined();
    expect(d.footnote).toContain("No Roth conversions are modeled");
  });

  it("leaves the full range alone", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsConvertingIn2036(), options: { range: "full", showCallout: false },
    });
    expect(d.table.rows.map((r) => r.year)).toEqual([2026, 2031, 2036]);
    expect(d.footnote).not.toContain("No Roth conversions");
  });
});
