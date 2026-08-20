import { describe, it, expect } from "vitest";
import { buildEarlyYearsHumanCapitalData } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

const OPTS = { tidbits: [] };

/** A projection year: salary, and the liquid portfolio at the start of it. */
const yr = (year: number, salaries: number, liquid: number) => ({
  year,
  ages: { client: 29 + (year - 2026) },
  income: { salaries, total: salaries },
  savings: { byAccount: {}, total: 0, employerTotal: 0 },
  portfolioAssets: { liquidTotal: liquid },
});

function ctx(years: ReturnType<typeof yr>[], inflationRate = 0.03): BuildDataContext {
  const clientData = { planSettings: { inflationRate, planStartYear: 2026 } };
  const bundle = { clientData, projection: { years }, scenarioLabel: "Base Case" };
  return {
    years,
    projection: { years },
    clientData,
    scenarioLabel: "Base Case",
    bundlesByRef: { base: bundle },
  } as unknown as BuildDataContext;
}

describe("buildEarlyYearsHumanCapitalData", () => {
  it("sums every future salary dollar DEFLATED, not nominal", () => {
    // 100_000 now + 100_000 in 2027 discounted at 3% = 100_000 + 97_087.38
    const d = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 50_000), yr(2027, 100_000, 60_000)]),
      OPTS,
    );
    expect(d.lifetimeEarnings.today).toBeCloseTo(197_087.38, 2);
    expect(d.lifetimeEarnings.nominal).toBe(200_000);
  });

  it("is not the nominal sum — a 0% inflation fixture would make this vacuous", () => {
    const real = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 50_000), yr(2027, 100_000, 60_000)]),
      OPTS,
    ).lifetimeEarnings;
    expect(real.today).toBeLessThan(200_000);
    expect(real.nominal).toBe(200_000);
  });

  it("quotes the portfolio from the plan's FIRST year", () => {
    const d = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 50_000), yr(2027, 100_000, 900_000)]),
      OPTS,
    );
    expect(d.invested).toEqual({ today: 50_000, nominal: 50_000 });
  });

  it("reports the multiple and names it in the takeaway", () => {
    const d = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 20_000), yr(2027, 100_000, 25_000)]),
      OPTS,
    );
    expect(d.multiple).toBeCloseTo(197_087.38 / 20_000, 6);
    expect(d.takeaway).toContain("10 times");
  });

  it("never states a multiple against an empty portfolio", () => {
    const d = buildEarlyYearsHumanCapitalData(ctx([yr(2026, 100_000, 0)]), OPTS);
    expect(d.multiple).toBeNull();
    expect(d.takeaway).not.toContain("Infinity");
    expect(d.takeaway).not.toContain("times");
  });

  it("never states a multiple that argues the opposite of the page", () => {
    // A portfolio bigger than the remaining pay would round to "1 times".
    const d = buildEarlyYearsHumanCapitalData(ctx([yr(2026, 50_000, 400_000)]), OPTS);
    expect(d.takeaway).not.toContain("times");
  });

  it("says so rather than drawing one bar when the plan projects no salary", () => {
    const d = buildEarlyYearsHumanCapitalData(ctx([yr(2026, 0, 400_000)]), OPTS);
    expect(d.isEmpty).toBe(true);
  });

  it("names the last year that still pays a salary", () => {
    const d = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 10_000), yr(2027, 100_000, 20_000), yr(2028, 0, 30_000)]),
      OPTS,
    );
    expect(d.lastEarningYear).toBe(2027);
  });

  it("reads the BASE bundle, not the deck's own scenario (R6)", () => {
    const base = [yr(2026, 200_000, 10_000)];
    const other = [yr(2026, 50_000, 10_000)];
    const c = {
      years: other,
      projection: { years: other },
      clientData: { planSettings: { inflationRate: 0.03, planStartYear: 2026 } },
      scenarioLabel: "Aggressive",
      bundlesByRef: {
        base: {
          clientData: { planSettings: { inflationRate: 0.03, planStartYear: 2026 } },
          projection: { years: base },
          scenarioLabel: "Base Case",
        },
      },
    } as unknown as BuildDataContext;
    const d = buildEarlyYearsHumanCapitalData(c, OPTS);
    expect(d.lifetimeEarnings).toEqual({ today: 200_000, nominal: 200_000 });
    expect(d.subtitle).toContain("Base Case");
  });

  it("falls back to its own tree when no base bundle was assembled", () => {
    const years = [yr(2026, 80_000, 12_000)];
    const c = {
      years,
      projection: { years },
      clientData: { planSettings: { inflationRate: 0.03, planStartYear: 2026 } },
      scenarioLabel: "Base Case",
    } as unknown as BuildDataContext;
    expect(buildEarlyYearsHumanCapitalData(c, OPTS).lifetimeEarnings).toEqual({
      today: 80_000,
      nominal: 80_000,
    });
  });

  it("carries salary checkpoints in both units", () => {
    const d = buildEarlyYearsHumanCapitalData(
      ctx([
        yr(2026, 100_000, 10_000),
        yr(2031, 115_927, 20_000),
        yr(2032, 119_405, 30_000),
      ]),
      OPTS,
    );

    expect(d.detailRows.map((row) => row.year)).toEqual([2026, 2031, 2032]);
    expect(d.detailRows[1].salary.nominal).toBe(115_927);
    expect(d.detailRows[1].salary.today).toBeCloseTo(100_000, -1);
  });

  it("puts both aggregate units in the takeaway", () => {
    const d = buildEarlyYearsHumanCapitalData(
      ctx([yr(2026, 100_000, 20_000), yr(2027, 100_000, 25_000)]),
      OPTS,
    );
    expect(d.takeaway).toContain("today");
    expect(d.takeaway).toContain("nominal as paid");
  });
});
