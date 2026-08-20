import { describe, it, expect } from "vitest";
import { buildEarlyYearsTidbitsData } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

/** `compounding-runway` opens with `{{client_first_name}}`. */
const NAMED = "compounding-runway";
/** `compounding-small-amounts` quotes `{{portfolio_assets}}`. */
const MONEY = "compounding-small-amounts";

function plan(firstName: string, liquid: number) {
  return {
    clientData: {
      planSettings: { planStartYear: 2026, inflationRate: 0, taxEngineMode: "bracket" },
      client: { firstName, spouseName: null, retirementAge: 65 },
      accounts: [],
      savingsRules: [],
      incomes: [],
    },
    projection: {
      years: [
        {
          year: 2026,
          ages: { client: 29 },
          income: { salaries: 0, total: 0 },
          savings: { byAccount: {}, total: 0, employerTotal: 0 },
          expenses: { taxes: 0, total: 0 },
          totalIncome: 0,
          portfolioAssets: { liquidTotal: liquid, total: liquid },
        },
      ],
    },
  };
}

/** The page's own scenario is DELIBERATELY different from the base bundle's, so
 *  a test can tell which one the tokens actually came from. */
function ctx(withBase: boolean): BuildDataContext {
  const own = plan("Wrong", 11_111);
  const base = plan("Cooper", 48_000);
  // Only `clientData`, `projection`, `monteCarlo` and `bundlesByRef` are read;
  // anything else here would imply a dependency the view model does not have.
  return {
    ...own,
    ...(withBase ? { bundlesByRef: { base } } : {}),
  } as unknown as BuildDataContext;
}

describe("buildEarlyYearsTidbitsData", () => {
  it("returns nothing when the advisor picked nothing", () => {
    expect(buildEarlyYearsTidbitsData(ctx(true), { tidbits: [] }).tidbits).toEqual([]);
  });

  it("keeps the advisor's picks in the order chosen", () => {
    const d = buildEarlyYearsTidbitsData(ctx(true), { tidbits: [MONEY, NAMED] });
    expect(d.tidbits.map((t) => t.id)).toEqual([MONEY, NAMED]);
  });

  it("drops an id no longer in the library rather than printing a hole", () => {
    const d = buildEarlyYearsTidbitsData(ctx(true), { tidbits: ["gone", NAMED] });
    expect(d.tidbits.map((t) => t.id)).toEqual([NAMED]);
  });

  it("resolves tokens against the BASE bundle, not the page's own context", () => {
    const d = buildEarlyYearsTidbitsData(ctx(true), { tidbits: [NAMED, MONEY] });
    expect(d.tidbits[0].body).toContain("Cooper");
    expect(d.tidbits[0].body).not.toContain("Wrong");
    expect(d.tidbits[1].body).toContain("$48,000");
  });

  // NOT for the Forge compute tool — `compute.ts:371-374` refuses any page that
  // declares `requiredScenarioRefs`, and this one does, so it never reaches
  // buildData. The fallback covers `bundlesByRef` being optional on
  // `BuildDataContext`: any caller that skips ref loading gets the plan's real
  // figures rather than a body full of em-dashes presented as real values.
  it("falls back to its own context when no base bundle was loaded", () => {
    const d = buildEarlyYearsTidbitsData(ctx(false), { tidbits: [NAMED, MONEY] });
    expect(d.tidbits[0].body).toContain("Wrong");
    expect(d.tidbits[1].body).toContain("$11,111");
  });

  it("leaves no unresolved placeholder and no em-dash fallback in a body", () => {
    const d = buildEarlyYearsTidbitsData(ctx(true), { tidbits: [NAMED, MONEY] });
    for (const t of d.tidbits) {
      expect(t.body).not.toContain("{{");
      expect(t.body).not.toContain(" — confidence");
    }
  });
});
