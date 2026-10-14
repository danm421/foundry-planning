import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine";
import { isTaxGrounded } from "@/lib/projection/is-tax-grounded";
import {
  caveatsFor,
  computeMetrics,
  metricDeltas,
  CAVEAT_FLAT_TAX,
  CAVEAT_IRMAA_SIBLING,
  CAVEAT_MAX_ITERATIONS,
  CAVEAT_NEW_ACCOUNT_MC,
  CAVEAT_NO_HEIR_TAX_RATE,
  CAVEAT_NO_SPENDING,
  CAVEAT_UNREACHABLE,
  type WhatIfMetrics,
} from "../metrics";
import { IDS, whatIfTree } from "./fixtures";

describe("isTaxGrounded", () => {
  it("is true only in bracket mode with tax-year rows loaded", () => {
    expect(isTaxGrounded({ planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] })).toBe(true);
    expect(isTaxGrounded({ planSettings: { taxEngineMode: "bracket" }, taxYearRows: [] })).toBe(false);
    expect(isTaxGrounded({ planSettings: { taxEngineMode: "flat" }, taxYearRows: [{}] })).toBe(false);
  });
});

describe("computeMetrics", () => {
  it("reads the engine's own figures", () => {
    const tree = whatIfTree();
    const projection = runProjectionWithEvents(tree);
    const m = computeMetrics(tree, projection, null);
    const last = projection.years.at(-1)!;
    expect(m.endingPortfolio).toBe(last.portfolioAssets.liquidTotal);
    expect(m.lifetimeTax).toBe(projection.years.reduce((s, y) => s + (y.expenses?.taxes ?? 0), 0));
    expect(m.successRate).toBeNull();
    expect(m.yearsFullyFunded).toBeGreaterThan(0);
  });

  it("passes the Monte Carlo success rate through", () => {
    const tree = whatIfTree();
    expect(computeMetrics(tree, runProjectionWithEvents(tree), 0.87).successRate).toBe(0.87);
  });
});

describe("metricDeltas", () => {
  const a: WhatIfMetrics = {
    successRate: 0.8, endingPortfolio: 100, lifetimeTax: 50, netToHeirs: null,
    heirIncomeTax: 0, yearsFullyFunded: 30, firstShortfallYear: null,
  };
  it("subtracts numbers and skips anything null on either side", () => {
    const b: WhatIfMetrics = { ...a, successRate: 0.85, endingPortfolio: 130, netToHeirs: 10 };
    const d = metricDeltas(a, b);
    expect(d.successRate).toBeCloseTo(0.05);
    expect(d.endingPortfolio).toBe(30);
    expect(d.lifetimeTax).toBe(0);
    expect(d).not.toHaveProperty("netToHeirs");
  });
});

describe("caveatsFor", () => {
  const metrics = (successRate: number | null): WhatIfMetrics => ({
    successRate, endingPortfolio: 0, lifetimeTax: 0, netToHeirs: null,
    heirIncomeTax: null, yearsFullyFunded: 0, firstShortfallYear: null,
  });

  it("warns that a success rate means little with no retirement spending", () => {
    const tree = whatIfTree();
    tree.expenses = [];
    expect(caveatsFor({ tree, metrics: metrics(1), solveStatus: null, addedAccounts: false })).toContain(CAVEAT_NO_SPENDING);
    expect(caveatsFor({ tree, metrics: metrics(null), solveStatus: null, addedAccounts: false })).not.toContain(CAVEAT_NO_SPENDING);
  });

  it("flags flat-rate tax, a solve that hit max-iterations, and Monte Carlo on a new account", () => {
    const tree = whatIfTree();
    tree.planSettings = { ...tree.planSettings, taxEngineMode: "flat" };
    const out = caveatsFor({ tree, metrics: metrics(0.9), solveStatus: "max-iterations", addedAccounts: true });
    expect(out).toEqual(expect.arrayContaining([CAVEAT_FLAT_TAX, CAVEAT_MAX_ITERATIONS, CAVEAT_NEW_ACCOUNT_MC]));
  });

  // An unreachable solve hands back the search's closest endpoint, which misses
  // the target: without this caveat Claude would report it as the answer.
  it("flags a solve that can't reach its target, and only that status", () => {
    const tree = whatIfTree();
    expect(caveatsFor({ tree, metrics: metrics(0.6), solveStatus: "unreachable", addedAccounts: false })).toContain(
      CAVEAT_UNREACHABLE,
    );
    for (const solveStatus of ["converged", "max-iterations", null]) {
      expect(caveatsFor({ tree, metrics: metrics(0.9), solveStatus, addedAccounts: false })).not.toContain(CAVEAT_UNREACHABLE);
    }
  });

  it("flags an IRMAA-capped conversion that has a sibling conversion", () => {
    const tree = whatIfTree();
    const conv = {
      id: "c1", name: "a", destinationAccountId: IDS.roth, sourceAccountIds: [IDS.k401],
      conversionType: "fixed_amount" as const, fixedAmount: 1, startYear: 2027, indexingRate: 0,
    };
    tree.rothConversions = [{ ...conv, irmaaCapTier: 0 }, { ...conv, id: "c2" }];
    expect(caveatsFor({ tree, metrics: metrics(null), solveStatus: null, addedAccounts: false })).toContain(CAVEAT_IRMAA_SIBLING);
  });

  it("flags pre-tax accounts with no heir tax rate set", () => {
    const tree = whatIfTree();
    tree.planSettings = { ...tree.planSettings, irdTaxRate: undefined };
    expect(caveatsFor({ tree, metrics: metrics(null), solveStatus: null, addedAccounts: false })).toContain(CAVEAT_NO_HEIR_TAX_RATE);
    tree.planSettings = { ...tree.planSettings, irdTaxRate: 0.24 };
    expect(caveatsFor({ tree, metrics: metrics(null), solveStatus: null, addedAccounts: false })).not.toContain(CAVEAT_NO_HEIR_TAX_RATE);
  });
});
