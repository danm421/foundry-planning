import { describe, it, expect } from "vitest";
import {
  buildRothConversionComparison,
  withoutConversionsMutations,
  type ConversionPlan,
} from "../view-model";
import type { ClientData, ProjectionYear, RothConversion } from "@/engine/types";

interface YearSpec {
  tax: number;
  conv?: number;
  taxable?: number;
  limitedBy?: "irmaa" | "bracket" | "sources" | null;
  irmaa?: number;
  /** Medicare enrollment this year. Defaults to enrolled whenever `irmaa` is set. */
  medicare?: boolean;
  rmd?: number;
  roth?: number;
  preTax?: number;
}

const yr = (year: number, s: YearSpec): ProjectionYear =>
  ({
    year,
    ages: { client: year - 1970, spouse: year - 1972 },
    taxResult: { flow: { totalTax: s.tax } },
    rothConversions: s.conv
      ? [
          {
            id: "rc",
            name: "Convert",
            gross: s.conv,
            taxable: s.taxable ?? s.conv,
            requested: s.conv,
            limitedBy: s.limitedBy ?? null,
          },
        ]
      : undefined,
    medicare:
      s.medicare ?? s.irmaa != null
        ? { totalAnnualCost: 0, totalIrmaaSurcharge: s.irmaa ?? 0 }
        : undefined,
    portfolioAssets: {
      retirement: { ira: s.preTax ?? 0, roth: s.roth ?? 0 },
      taxable: { brk: 100_000 },
      cash: {},
    },
    accountLedgers: {
      ira: { endingValue: s.preTax ?? 0, rmdAmount: s.rmd ?? 0 },
      roth: { endingValue: s.roth ?? 0, rmdAmount: 0 },
    },
  }) as unknown as ProjectionYear;

const CONVERSION: RothConversion = {
  id: "rc",
  name: "Convert",
  destinationAccountId: "roth",
  sourceAccountIds: ["ira"],
  conversionType: "fixed_amount",
  fixedAmount: 50_000,
  startYear: 2030,
  endYear: 2032,
  indexingRate: 0,
};

const clientData = (over: Partial<ClientData> = {}) =>
  ({
    accounts: [
      { id: "ira", name: "John's IRA", subType: "traditional_ira" },
      { id: "roth", name: "John's Roth IRA", subType: "roth_ira" },
    ],
    planSettings: { taxEngineMode: "flat", irdTaxRate: 0.35 },
    rothConversions: [CONVERSION],
    ...over,
  }) as unknown as ClientData;

const plan = (
  years: ProjectionYear[],
  heirs: Record<number, number>,
  data: ClientData = clientData(),
): ConversionPlan => ({
  clientData: data,
  years,
  heirsAt: (year) => heirs[year] ?? 0,
});

// 2029 quiet · 2030-2032 convert $50k (+$11k tax each) · 2033-2035 lower tax.
const WITH_YEARS = [
  yr(2029, { tax: 20_000, preTax: 500_000 }),
  yr(2030, { tax: 31_000, conv: 50_000, preTax: 460_000, roth: 50_000 }),
  yr(2031, { tax: 31_500, conv: 50_000, preTax: 420_000, roth: 105_000 }),
  yr(2032, { tax: 32_000, conv: 50_000, preTax: 380_000, roth: 160_000, irmaa: 0 }),
  yr(2033, { tax: 18_000, irmaa: 2_400, rmd: 15_000, preTax: 390_000, roth: 170_000 }),
  yr(2034, { tax: 18_500, irmaa: 2_400, rmd: 16_000, preTax: 400_000, roth: 180_000 }),
  yr(2035, { tax: 19_000, irmaa: 0, rmd: 17_000, preTax: 410_000, roth: 190_000 }),
];
const WITHOUT_YEARS = [
  yr(2029, { tax: 20_000, preTax: 500_000 }),
  yr(2030, { tax: 20_000, preTax: 520_000 }),
  yr(2031, { tax: 20_500, preTax: 545_000 }),
  yr(2032, { tax: 21_000, preTax: 570_000, irmaa: 0 }),
  yr(2033, { tax: 24_000, irmaa: 0, rmd: 22_000, preTax: 585_000 }),
  yr(2034, { tax: 25_000, irmaa: 0, rmd: 23_000, preTax: 600_000 }),
  yr(2035, { tax: 26_000, irmaa: 0, rmd: 24_000, preTax: 615_000 }),
];
// Behind through 2032, ahead from 2033.
const HEIRS_WITH = { 2029: 1_000_000, 2030: 990_000, 2031: 985_000, 2032: 995_000, 2033: 1_020_000, 2034: 1_050_000, 2035: 1_090_000 };
const HEIRS_WITHOUT = { 2029: 1_000_000, 2030: 1_000_000, 2031: 1_000_000, 2032: 1_000_000, 2033: 1_000_000, 2034: 1_000_000, 2035: 1_000_000 };

const build = (
  withYears = WITH_YEARS,
  heirsWith: Record<number, number> = HEIRS_WITH,
  withData = clientData(),
) =>
  buildRothConversionComparison({
    planLabel: "Base Case",
    withPlan: plan(withYears, heirsWith, withData),
    withoutPlan: plan(WITHOUT_YEARS, HEIRS_WITHOUT, clientData({ rothConversions: [] })),
  });

describe("buildRothConversionComparison", () => {
  it("adds up what was converted and when", () => {
    const d = build();
    expect(d.totals!.converted).toBe(150_000);
    expect(d.schedule.map((r) => r.year)).toEqual([2030, 2031, 2032]);
  });

  it("splits the tax change into the conversion years and every other year", () => {
    const t = build().totals!;
    expect(t.extraTax).toBe(11_000 + 11_000 + 11_000);
    expect(t.laterTaxSaved).toBe(6_000 + 6_500 + 7_000);
  });

  it("counts Medicare surcharges separately from tax", () => {
    expect(build().totals!.extraMedicare).toBe(4_800);
  });

  it("measures the heirs' change at the end of the plan", () => {
    expect(build().totals!.heirsChange).toBe(90_000);
    expect(build().advantage.map((p) => p.year)).toEqual([2030, 2031, 2032, 2033, 2034, 2035]);
  });

  it("finds the year the family pulls ahead and stays ahead", () => {
    expect(build().breakeven).toEqual({ kind: "year", year: 2033 });
  });

  it("does not call a dip-and-recover a break-even before the LAST dip", () => {
    const heirs = { ...HEIRS_WITH, 2033: 1_010_000, 2034: 990_000, 2035: 1_090_000 };
    expect(build(WITH_YEARS, heirs).breakeven).toEqual({ kind: "year", year: 2035 });
  });

  it("says when the family is never behind", () => {
    const heirs = { 2029: 1_000_000, 2030: 1_001_000, 2031: 1_002_000, 2032: 1_003_000, 2033: 1_004_000, 2034: 1_005_000, 2035: 1_006_000 };
    expect(build(WITH_YEARS, heirs).breakeven).toEqual({ kind: "immediate" });
  });

  it("says when the conversions never pay off, and says so in the takeaway", () => {
    const heirs = { ...HEIRS_WITH, 2033: 990_000, 2034: 980_000, 2035: 970_000 };
    const d = build(WITH_YEARS, heirs);
    expect(d.breakeven).toEqual({ kind: "never" });
    expect(d.takeaway.join(" ")).toContain("don't pay for themselves");
  });

  it("prints one row per conversion year with that year's extra tax and ages", () => {
    const rows = build().schedule;
    expect(rows.map((r) => r.year)).toEqual([2030, 2031, 2032]);
    expect(rows[0]).toMatchObject({ clientAge: 60, spouseAge: 58, converted: 50_000, extraTax: 11_000 });
  });

  it("charges each year's Medicare change to the year two years later", () => {
    const rows = build().schedule;
    // 2030 → 2032 (enrolled, no change), 2031 → 2033 (+$2,400), 2032 → 2034 (+$2,400).
    expect(rows.map((r) => r.extraMedicare)).toEqual([0, 2_400, 2_400]);
  });

  it("leaves the Medicare cell blank when nobody is on Medicare two years later", () => {
    const years = WITH_YEARS.map((y) =>
      y.year === 2032 ? yr(2032, { tax: 32_000, conv: 50_000, preTax: 380_000, roth: 160_000 }) : y,
    );
    const withoutNoMedicare = WITHOUT_YEARS.map((y) =>
      y.year === 2032 ? yr(2032, { tax: 21_000, preTax: 570_000 }) : y,
    );
    const d = buildRothConversionComparison({
      planLabel: "Base Case",
      withPlan: plan(years, HEIRS_WITH),
      withoutPlan: plan(withoutNoMedicare, HEIRS_WITHOUT, clientData({ rothConversions: [] })),
    });
    expect(d.schedule[0].extraMedicare).toBeNull();
  });

  it("notes a year the Medicare limit or an empty account cut short", () => {
    const years = WITH_YEARS.map((y) =>
      y.year === 2031
        ? yr(2031, { tax: 31_500, conv: 50_000, limitedBy: "irmaa", preTax: 420_000, roth: 105_000 })
        : y.year === 2032
          ? yr(2032, { tax: 32_000, conv: 50_000, limitedBy: "sources", preTax: 380_000, roth: 160_000, irmaa: 0 })
          : y,
    );
    expect(build(years).schedule.map((r) => r.note)).toEqual([
      null,
      "Held under the Medicare limit",
      "Account emptied",
    ]);
  });

  it("shows the taxable column only when some conversion carried after-tax basis", () => {
    expect(build().showTaxable).toBe(false);
    const years = WITH_YEARS.map((y) =>
      y.year === 2030 ? yr(2030, { tax: 31_000, conv: 50_000, taxable: 40_000, preTax: 460_000, roth: 50_000 }) : y,
    );
    expect(build(years).showTaxable).toBe(true);
  });

  it("hides the bracket column on the flat tax engine and says why", () => {
    const d = build();
    expect(d.showBracket).toBe(false);
    expect(d.schedule.every((r) => r.bracket === null)).toBe(true);
    expect(d.footnotes.join(" ")).toContain("flat tax rate");
  });

  it("compares the first year a withdrawal is required, with and without", () => {
    expect(build().rmd).toEqual({ year: 2033, clientAge: 63, with: 15_000, without: 22_000 });
  });

  it("splits the savings by tax treatment at the end of the plan", () => {
    const mix = build().mix!;
    expect(mix.year).toBe(2035);
    expect(mix.with).toMatchObject({ roth: 190_000, preTax: 410_000, taxable: 100_000 });
    expect(mix.without).toMatchObject({ roth: 0, preTax: 615_000, taxable: 100_000 });
  });

  it("puts lifetime tax, Medicare, the heirs and the first required withdrawal side by side", () => {
    const rows = build().lifetime;
    expect(rows.map((r) => r.label)).toEqual([
      "Tax over the plan",
      "Medicare surcharges",
      "Heirs receive, after tax",
      "Required withdrawal, 2033 (age 63)",
    ]);
    expect(rows[0]).toMatchObject({ without: 156_500, with: 170_000, betterIsLower: true });
    expect(rows[2]).toMatchObject({ without: 1_000_000, with: 1_090_000, betterIsLower: false });
    expect(rows[3]).toMatchObject({ without: 22_000, with: 15_000, betterIsLower: true });
  });

  it("drops the Medicare row when neither plan pays a surcharge", () => {
    const years = WITH_YEARS.map((y) => yr(y.year, { tax: y.taxResult!.flow.totalTax, conv: y.rothConversions?.[0]?.gross }));
    expect(build(years).lifetime.map((r) => r.label)).not.toContain("Medicare surcharges");
  });

  it("describes the strategy from the conversions that actually ran", () => {
    expect(build().strategy).toEqual([
      "Convert $50,000 a year from John's IRA to John's Roth IRA, 2030 through 2032.",
    ]);
  });

  it("tells the story in order: the cost, the later savings, Medicare, the family", () => {
    const t = build().takeaway;
    expect(t[0]).toBe(
      "Converting $150,000 to Roth from 2030 through 2032 adds about $33,000 to your tax bill in those years.",
    );
    expect(t[1]).toBe(
      "Afterward your taxes run lower, about $20,000 less over the rest of the plan, largely because required withdrawals are smaller.",
    );
    expect(t[2]).toBe("The higher income also adds about $4,800 in Medicare surcharges.");
    expect(t[3]).toBe(
      "From 2033 on, your family comes out ahead: by the end of the plan, your heirs receive about $90,000 more after tax.",
    );
  });

  it("states the comparison it makes", () => {
    expect(build().comparisonNote).toContain("the same plan without these Roth conversions");
  });

  it("states the heirs' tax rate it assumes, and warns when it is zero", () => {
    expect(build().footnotes.join(" ")).toContain("35% income tax");
    const zero = build(WITH_YEARS, HEIRS_WITH, clientData({ planSettings: { taxEngineMode: "flat", irdTaxRate: 0 } } as never));
    expect(zero.footnotes.join(" ")).toContain("understates the benefit of converting");
  });

  describe("when there is nothing to compare", () => {
    it("explains a plan with no conversions", () => {
      const d = build(WITH_YEARS, HEIRS_WITH, clientData({ rothConversions: [] }));
      expect(d.emptyMessage).toContain("no Roth conversions");
      expect(d.totals).toBeNull();
    });

    it("ignores a conversion that is switched off", () => {
      const d = build(WITH_YEARS, HEIRS_WITH, clientData({ rothConversions: [{ ...CONVERSION, enabled: false }] }));
      expect(d.emptyMessage).toContain("no Roth conversions");
    });

    it("explains conversions the Medicare limit zeroed out", () => {
      const years = WITH_YEARS.map((y) =>
        y.rothConversions
          ? ({ ...y, rothConversions: [{ ...y.rothConversions[0], gross: 0, taxable: 0, limitedBy: "irmaa" }] } as ProjectionYear)
          : y,
      );
      expect(build(years).emptyMessage).toContain("Medicare surcharge limit");
    });
  });
});

describe("withoutConversionsMutations", () => {
  it("removes every conversion in the plan, switched on or off", () => {
    const data = clientData({ rothConversions: [CONVERSION, { ...CONVERSION, id: "rc2", enabled: false }] });
    expect(withoutConversionsMutations(data)).toEqual([
      { kind: "roth-conversion-upsert", id: "rc", value: null },
      { kind: "roth-conversion-upsert", id: "rc2", value: null },
    ]);
  });
});
