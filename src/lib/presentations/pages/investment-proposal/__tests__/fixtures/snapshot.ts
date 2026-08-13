// A complete, realistic frozen snapshot. Numbers match the walkthrough case
// (VTI 50 / GLD 20 / VOO 30 against a $185,405 taxable account) so a reader can
// sanity-check the rendered page against a real screen.
import type { InvestmentProposalBundle } from "@/lib/presentations/investment-proposal-bundle";

const side = (totalValue: number, mean: number, geo: number, sd: number, sharpe: number) => ({
  totalValue,
  assetMix: [
    { assetClassId: "ac1", name: "US Large Cap", weight: 0.8 },
    { assetClassId: "ac2", name: "Commodities", weight: 0.2 },
  ],
  realized: {
    annArithMean: mean, annGeoReturn: geo, annVolatility: sd,
    downsideDeviation: sd * 0.7, sharpe, sortino: sharpe * 1.3,
    maxDrawdown: 0.24, nMonths: 120,
  },
  cma: { arithmeticMean: mean, geometricReturn: geo, stdDev: sd, sharpe },
  coveragePct: 1,
});

export const BUNDLE: InvestmentProposalBundle = {
  proposalId: "p1",
  name: "Move to the core model",
  targetLabel: "60/40 Core",
  status: "draft",
  computedAt: "2026-08-12T23:44:00.000Z",
  snapshot: {
    version: 1,
    computedAt: "2026-08-12T23:44:00.000Z",
    compute: {
      current: side(185405, 0.043, 0.032, 0.077, 0.31),
      proposed: side(185405, 0.08, 0.066, 0.154, 0.68),
      assetMixDelta: [
        { assetClassId: "ac1", name: "US Large Cap", currentPct: 0.55, targetPct: 0.8, diffPct: 0.25 },
        { assetClassId: "ac2", name: "Commodities", currentPct: 0.45, targetPct: 0.2, diffPct: -0.25 },
      ],
      tradeSummary: [
        { assetClassId: "ac1", name: "US Large Cap", currentValue: 101972, targetValue: 148324, deltaValue: 46352, action: "buy" },
        { assetClassId: "ac2", name: "Commodities", currentValue: 83433, targetValue: 37081, deltaValue: -46352, action: "sell" },
      ],
      tax: {
        taxableMarketValue: 185405, taxableCostBasis: 100000, realizedGain: 85405,
        effectiveRate: 0.432, rateSource: "engine", estimatedTax: 36911, notes: [],
      },
      realizedWindow: { windowStart: "2016-08", windowEnd: "2026-07", nMonths: 120, insufficientHistory: false, shortHistory: false },
      sourceUnresolvedTickers: [],
    },
    fees: {
      currentBlendedEr: 0.0023, proposedBlendedEr: 0.001,
      currentCoveragePct: 1, proposedCoveragePct: 1,
      advisoryFeeCurrent: null, advisoryFeeProposed: null,
      annualDollarsCurrent: 436, annualDollarsProposed: 193, annualDollarsSaved: 243,
    },
    suitability: {
      clientLevel: "moderate", clientScore: 50, bindingConstraint: "tolerance",
      confirmedAt: "2026-07-29T00:00:00.000Z",
      currentPlacement: { level: "conservative", estimated: true },
      proposedPlacement: { level: "moderately_aggressive", estimated: true },
      currentExceedsProfile: false, proposedMatchesProfile: false,
    },
    backtest: {
      windowStart: "2016-08", windowEnd: "2026-07", nMonths: 120, startValue: 100000,
      current: [{ date: "2016-08", value: 100000 }, { date: "2026-07", value: 137000 }],
      proposed: [{ date: "2016-08", value: 100000 }, { date: "2026-07", value: 189000 }],
      endingCurrent: 137000, endingProposed: 189000,
    },
    stress: [
      { key: "gfc", label: "Global financial crisis", start: "2007-11", end: "2009-02", available: false, unavailableReason: "One or more holdings launched after this period.", currentReturn: null, proposedReturn: null, currentDrawdown: null, proposedDrawdown: null, currentDollars: null, proposedDollars: null },
      { key: "covid", label: "COVID crash", start: "2020-01", end: "2020-03", available: true, unavailableReason: null, currentReturn: -0.205, proposedReturn: -0.159, currentDrawdown: 0.205, proposedDrawdown: 0.166, currentDollars: -37973, proposedDollars: -29401 },
    ],
    outcomes: {
      startValue: 185405,
      current: [{ years: 10, p10: 180000, p50: 254000, p90: 358000 }],
      proposed: [{ years: 10, p10: 195000, p50: 351000, p90: 631000 }],
    },
    breakEven: { estimatedTax: 36911, annualBenefit: 6470, years: 5.7, verdict: "recovered" },
    targetHoldings: [
      { ticker: "VTI", name: "Vanguard Total Stock Market ETF", weight: 0.5, expenseRatio: 0.0003 },
      { ticker: "GLD", name: "SPDR Gold Shares", weight: 0.2, expenseRatio: 0.004 },
      { ticker: "VOO", name: "Vanguard S&P 500 ETF", weight: 0.3, expenseRatio: 0.0003 },
    ],
  },
};
