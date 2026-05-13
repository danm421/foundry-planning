import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { TaxResult, BracketTier } from "@/lib/tax/types";
import { buildBracketStackCellDrill } from "../bracket-stacking";
import type { CellDrillContext } from "../types";

const tier22: BracketTier = { from: 94_300, to: 201_050, rate: 0.22 };
const tier37top: BracketTier = { from: 383_900, to: null, rate: 0.37 };

const ctx: CellDrillContext = {
  accountNames: { acc_1: "Joint Brokerage" },
  incomes: [
    { id: "inc_w", name: "Client Salary", type: "salary", owner: "client" } as never,
  ],
  accounts: [],
};

function makeYear(args: {
  bySource: Record<string, { type: string; amount: number }>;
  incomeTaxBase: number;
  tier: BracketTier;
}): ProjectionYear {
  const taxResult = {
    income: { earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0, dividends: 0,
      capitalGains: 0, shortCapitalGains: 0, totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0 },
    flow: { incomeTaxBase: args.incomeTaxBase },
    diag: { marginalFederalRate: args.tier.rate, marginalBracketTier: args.tier,
      effectiveFederalRate: 0, bracketsUsed: {} as never, inflationFactor: 1 },
  } as unknown as TaxResult;
  return {
    year: 2030, ages: { client: 60 },
    taxResult,
    taxDetail: {
      earnedIncome: 0, ordinaryIncome: 0, dividends: 0, capitalGains: 0,
      stCapitalGains: 0, qbi: 0, taxExempt: 0,
      bySource: args.bySource,
    },
  } as unknown as ProjectionYear;
}

describe("buildBracketStackCellDrill", () => {
  it("places the boundary at the first row whose cumulative crosses tier.from", () => {
    // Tier from: 94,300. Rows sorted desc: 80k, 30k, 20k.
    // Cumulative: 80k → 110k (crosses 94.3k) → 130k. Boundary at index 1.
    const year = makeYear({
      tier: tier22,
      incomeTaxBase: 130_000,
      bySource: {
        inc_w: { type: "earned_income", amount: 80_000 },
        "acc_1:oi": { type: "ordinary_income", amount: 30_000 },
        "acc_1:stcg": { type: "stcg", amount: 20_000 },
      },
    });
    const props = buildBracketStackCellDrill({ year, columnKey: "intoBracket", ctx });
    expect(props.title).toBe("Amount Into Federal Marginal Bracket — 2030");
    expect(props.total).toBe(35_700); // 130_000 - 94_300
    expect(props.groups).toHaveLength(1);
    expect(props.groups[0].rows).toHaveLength(3);
    expect(props.groups[0].boundaryIndex).toBe(1);
    expect(props.groups[0].rows[1].meta).toMatch(/lower bracket/i);
    expect(props.footnote).toMatch(/illustrative/i);
  });

  it("excludes dividends and LT capital gains from the ordinary stack", () => {
    const year = makeYear({
      tier: tier22,
      incomeTaxBase: 100_000,
      bySource: {
        inc_w: { type: "earned_income", amount: 100_000 },
        "acc_1:qdiv": { type: "dividends", amount: 50_000 },
        "acc_1:ltcg": { type: "capital_gains", amount: 30_000 },
      },
    });
    const props = buildBracketStackCellDrill({ year, columnKey: "intoBracket", ctx });
    expect(props.groups[0].rows.map((r) => r.id)).toEqual(["inc_w"]);
  });

  it("returns an empty group when intoBracket is 0", () => {
    const year = makeYear({
      tier: tier22,
      incomeTaxBase: 50_000, // below tier.from
      bySource: { inc_w: { type: "earned_income", amount: 50_000 } },
    });
    const props = buildBracketStackCellDrill({ year, columnKey: "intoBracket", ctx });
    expect(props.total).toBe(0);
    expect(props.groups[0].rows).toEqual([]);
  });

  it("handles the top bracket (tier.to === null)", () => {
    const year = makeYear({
      tier: tier37top,
      incomeTaxBase: 500_000,
      bySource: {
        inc_w: { type: "earned_income", amount: 400_000 },
        "acc_1:oi": { type: "ordinary_income", amount: 100_000 },
      },
    });
    const props = buildBracketStackCellDrill({ year, columnKey: "intoBracket", ctx });
    expect(props.total).toBe(116_100); // 500k - 383.9k
    expect(props.groups[0].boundaryIndex).toBe(0); // first row already crosses
  });
});
