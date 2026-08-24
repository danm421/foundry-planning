import { describe, it, expect } from "vitest";
import {
  buildEarlyYearsRothData,
  EARLY_YEARS_ROTH_PAGE_ID,
  ROTH_ALL_ROTH_KEY,
  ROTH_TRADITIONAL_KEY,
} from "../view-model";
import { derivedKey } from "@/lib/presentations/derived-refs";
import type { BuildDataContext } from "@/components/presentations/registry";

const OPTS = { tidbits: [] };

/** A projection year. `expenses.total` INCLUDES tax, as the engine's does. */
const yr = (age: number, taxes: number, spend: number) => ({
  year: 2026 + (age - 29),
  ages: { client: age },
  income: { salaries: age < 65 ? 120_000 : 0, total: 120_000 },
  savings: { byAccount: {}, total: 12_000, employerTotal: 0 },
  expenses: { taxes, total: taxes + spend },
  portfolioAssets: { liquidTotal: 500_000 },
});

/** Ages 29..70: 36 working years (29..64), 6 retired (65..70). */
const years = (workingTax: number, retiredTax: number, spend: number) =>
  Array.from({ length: 42 }, (_, i) =>
    29 + i < 65 ? yr(29 + i, workingTax, spend) : yr(29 + i, retiredTax, spend),
  );

function ctx(
  trad: ReturnType<typeof years>,
  roth: ReturnType<typeof years>,
  over: Record<string, unknown> = {},
): BuildDataContext {
  const clientData = {
    planSettings: { inflationRate: 0, planStartYear: 2026, taxEngineMode: "bracket" },
    client: { retirementAge: 65 },
    accounts: [{ id: "a1", subType: "401k", owners: [] }],
    savingsRules: [
      {
        id: "r1",
        accountId: "a1",
        annualAmount: 0,
        annualPercent: 0.08,
        isDeductible: true,
        startYear: 2020,
        endYear: 2060,
      },
    ],
    incomes: [
      {
        id: "i1",
        type: "salary",
        name: "S",
        annualAmount: 120_000,
        owner: "client",
        growthRate: 0,
        startYear: 2020,
        endYear: 2060,
      },
    ],
    ...over,
  };
  const bundle = (ys: ReturnType<typeof years>, label: string) => ({
    clientData,
    projection: { years: ys },
    scenarioLabel: label,
  });
  return {
    years: trad,
    projection: { years: trad },
    clientData,
    scenarioLabel: "Base Case",
    bundlesByRef: {
      base: bundle(trad, "Base Case"),
      [derivedKey(EARLY_YEARS_ROTH_PAGE_ID, ROTH_TRADITIONAL_KEY)]: bundle(
        trad,
        "All traditional",
      ),
      [derivedKey(EARLY_YEARS_ROTH_PAGE_ID, ROTH_ALL_ROTH_KEY)]: bundle(roth, "All Roth"),
    },
  } as unknown as BuildDataContext;
}

const TRAD = years(20_000, 8_000, 60_000);
const ROTH = years(24_000, 3_000, 60_000);

describe("buildEarlyYearsRothData", () => {
  it("splits tax at the client's retirement age", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS);
    expect(d.rows[0].traditional.today).toBeCloseTo(36 * 20_000, 6);
    expect(d.rows[1].traditional.today).toBeCloseTo(6 * 8_000, 6);
    expect(d.rows[2].traditional.today).toBeCloseTo(36 * 20_000 + 6 * 8_000, 6);
    expect(d.rows[0].roth.today).toBeCloseTo(36 * 24_000, 6);
    expect(d.rows[1].roth.today).toBeCloseTo(6 * 3_000, 6);
  });

  it("averages retirement spending NET of tax", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS);
    expect(d.rows[3].traditional.today).toBeCloseTo(60_000, 6);
    expect(d.rows[3].roth.today).toBeCloseTo(60_000, 6);
  });

  it("marks the tax rows as lower-is-better and the spending row as higher-is-better", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS);
    expect(d.rows.map((r) => r.betterIsLower)).toEqual([true, true, true, false]);
  });

  it("footnotes a plan whose spending does not move between the two", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS);
    expect(d.spendingIsFixed).toBe(true);
  });

  it("names whichever column is actually cheaper, in BOTH directions", () => {
    // This fixture's 36 working years at +$4,000 of tax outweigh its 6 retired
    // years at -$5,000, so traditional wins — and the sheet must say so rather
    // than assume the argument it would like to make.
    expect(buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS).takeaway).toContain(
      "all-traditional",
    );
    // Flip the retirement saving to something the deferral really buys back.
    const rothWins = years(21_000, 1_000, 60_000);
    expect(buildEarlyYearsRothData(ctx(TRAD, rothWins), OPTS).takeaway).toContain("all-Roth");
  });

  it("does NOT footnote a plan where the spending really separates", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, years(24_000, 3_000, 66_000)), OPTS);
    expect(d.spendingIsFixed).toBe(false);
  });

  it("says nothing rather than declaring a winner over a rounding difference", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, years(20_000, 8_000, 60_000)), OPTS);
    expect(d.takeaway).toBeNull();
  });

  it("refuses to compare in flat tax mode", () => {
    const d = buildEarlyYearsRothData(
      ctx(TRAD, ROTH, {
        planSettings: { inflationRate: 0, planStartYear: 2026, taxEngineMode: "flat" },
      }),
      OPTS,
    );
    expect(d.rows).toEqual([]);
    expect(d.emptyMessage).toContain("bracket");
  });

  it("refuses to compare with no 401(k) or 403(b) on the plan", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH, { accounts: [{ id: "a1", subType: "ira", owners: [] }] }), OPTS);
    expect(d.rows).toEqual([]);
    expect(d.emptyMessage).toContain("401(k)");
  });

  it("DEFLATES — a 0% inflation fixture would make this vacuous", () => {
    const d = buildEarlyYearsRothData(
      ctx(TRAD, ROTH, {
        planSettings: { inflationRate: 0.03, planStartYear: 2026, taxEngineMode: "bracket" },
      }),
      OPTS,
    );
    expect(d.rows[0].traditional.today).toBeLessThan(36 * 20_000);
    expect(d.rows[0].traditional.today).toBeGreaterThan(0);
    expect(d.rows[0].traditional.nominal).toBe(36 * 20_000);
  });

  it("renders its empty state when a variant is missing", () => {
    const c = ctx(TRAD, ROTH);
    delete (c.bundlesByRef as Record<string, unknown>)[
      derivedKey(EARLY_YEARS_ROTH_PAGE_ID, ROTH_ALL_ROTH_KEY)
    ];
    expect(buildEarlyYearsRothData(c, OPTS).rows).toEqual([]);
  });

  it("adds bounded annual tax checkpoints with both units", () => {
    const d = buildEarlyYearsRothData(
      ctx(TRAD, ROTH, {
        planSettings: { inflationRate: 0.03, planStartYear: 2026, taxEngineMode: "bracket" },
      }),
      OPTS,
    );
    expect(d.detailRows[0].year).toBe(2026);
    expect(d.detailRows.some((row) => row.age === 65)).toBe(true);
    expect(d.detailRows.at(-1)?.year).toBe(2067);
    expect(d.detailRows[1].traditionalTax.nominal).toBe(20_000);
    expect(d.detailRows[1].traditionalTax.today).toBeLessThan(20_000);
  });

  it("keeps the shipped exact-dollar precision and puts both lifetime-tax units in the takeaway", () => {
    const d = buildEarlyYearsRothData(ctx(TRAD, ROTH), OPTS);
    expect(d.takeaway).toContain("$114,000 today");
    expect(d.takeaway).not.toContain("$114K");
    expect(d.takeaway).toContain("future-year dollars");
  });

  it("drops the future-year gap when the two units disagree on the cheaper choice", () => {
    const traditionalLate = years(0, 20_000, 60_000);
    const rothEarly = years(3_000, 0, 60_000);
    const d = buildEarlyYearsRothData(
      ctx(traditionalLate, rothEarly, {
        planSettings: { inflationRate: 0.03, planStartYear: 2026, taxEngineMode: "bracket" },
      }),
      OPTS,
    );

    expect(d.rows[2].traditional.today).toBeLessThan(d.rows[2].roth.today);
    expect(d.rows[2].traditional.nominal).toBeGreaterThan(d.rows[2].roth.nominal);
    expect(d.takeaway).toContain("all-traditional");
    expect(d.takeaway).toContain("today less tax paid");
    expect(d.takeaway).not.toContain("future-year dollars");
  });
});
