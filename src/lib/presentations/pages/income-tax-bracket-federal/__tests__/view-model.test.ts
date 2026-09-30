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

  it("charts the income tax base as other income plus the taxable conversion, over the bracket floors", () => {
    const years = makeTaxYears();
    years.find((y) => y.year === 2026)!.rothConversions = [
      { id: "rc1", name: "Fill 24%", gross: 50_000, taxable: 50_000, requested: 50_000, limitedBy: null },
    ];
    const d = buildTaxBracketFederalDrillData({ ...base, years, options: { range: "full", showCallout: false } });
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual(["incomeBase", "conversion"]);
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const incomeBase = d.chartSpec!.stacks.find((s) => s.seriesId === "incomeBase")!;
    const conversion = d.chartSpec!.stacks.find((s) => s.seriesId === "conversion")!;
    // The two slices stack to exactly the income tax base, 384_200.
    expect(conversion.values[i]).toBe(50_000);
    expect(incomeBase.values[i]).toBe(334_200);
    // One line per floor in view, in each year's own dollars. The fixture's
    // 2026 ladder is 10/22/24/32 and its 2031 ladder 10/12/22, so every rate
    // but 10% (a $0 floor, never drawn) gets a line — and each line breaks in
    // the years whose ladder has no tier at its rate.
    const floor = (label: string) => d.chartSpec!.lines.find((l) => l.label === label)!.values;
    expect(d.chartSpec!.lines.map((l) => l.label)).toEqual(["12% floor", "22% floor", "24% floor", "32% floor"]);
    const j = d.chartSpec!.xAxis.domain.indexOf(2031);
    expect([floor("22% floor")[i], floor("22% floor")[j]]).toEqual([23_200, 94_300]);
    expect([floor("24% floor")[i], floor("24% floor")[j]]).toEqual([383_900, NaN]);
    expect([floor("12% floor")[i], floor("12% floor")[j]]).toEqual([NaN, 23_200]);
    // The legend names every series and every floor.
    expect(d.chartSpec!.legend.items.map((it) => it.label)).toEqual([
      "Income tax base", "Roth conversion", "12% floor", "22% floor", "24% floor", "32% floor",
    ]);
  });

  it("shares the screen chart's ceiling and stops a floor at it, so no line can drag the axis up", () => {
    // 2026 sits in the 24% tier (top 487_450) → the shared ceiling is 550k.
    // The 32% floor is 487_450 there; a year whose ladder put it above the
    // ceiling must print no point, or the PDF polyline — which nothing clips
    // — would stretch the axis to fit it.
    const years = makeTaxYears();
    const y2031 = years.find((y) => y.year === 2031)!;
    y2031.taxResult!.diag.incomeBracketsForFiling = [
      { from: 0, to: 23_200, rate: 0.10 },
      { from: 23_200, to: 94_300, rate: 0.12 },
      { from: 94_300, to: 700_000, rate: 0.22 },
      { from: 700_000, to: null, rate: 0.32 },
    ];
    const d = buildTaxBracketFederalDrillData({ ...base, years, options: { range: "full", showCallout: false } });
    expect(d.chartSpec!.yAxis.domain[1]).toBe(550_000);
    const floor32 = d.chartSpec!.lines.find((l) => l.label === "32% floor")!.values;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const j = d.chartSpec!.xAxis.domain.indexOf(2031);
    expect(floor32[i]).toBe(487_450);
    expect(floor32[j]).toBeNaN();
  });

  it("colours each floor by its rank in the ladder, never with the bars' blue or orange", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "full", showCallout: false } });
    const barColors = d.chartSpec!.stacks.map((s) => s.color);
    const lineColors = d.chartSpec!.lines.map((l) => l.color);
    expect(new Set(lineColors).size).toBe(lineColors.length);
    for (const c of lineColors) expect(barColors).not.toContain(c);
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

  it("still charts the year's income tax base — the bar is what was earned, the footnote is what AMT does to the next dollar", () => {
    const d = buildTaxBracketFederalDrillData({
      ...base, years: yearsWithAmt(), options: { range: "full", showCallout: false },
    });
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const total = d.chartSpec!.stacks.reduce((sum, s) => sum + s.values[i], 0);
    expect(total).toBe(384_200);
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
      { id: "rc1", name: "Fill the 12% bracket", gross: 40_000, taxable: 40_000, requested: 40_000, limitedBy: null },
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
