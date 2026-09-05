import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine";
import type { TaxResult, BracketTier } from "@/lib/tax/types";
import { buildBracketFillModel } from "../tax-bracket-chart";
import { makeYear as makeBareYear } from "./fixtures";

const tier10: BracketTier = { from: 0, to: 23_200, rate: 0.1 };
const tier12: BracketTier = { from: 23_200, to: 94_300, rate: 0.12 };
const tier22: BracketTier = { from: 94_300, to: 201_050, rate: 0.22 };
const tier24: BracketTier = { from: 201_050, to: 383_900, rate: 0.24 };
const tier37: BracketTier = { from: 383_900, to: null, rate: 0.37 };
const mfjBrackets: BracketTier[] = [tier10, tier12, tier22, tier24, tier37];

// A single filer's ladder — roughly half the MFJ ceilings, the shape the
// engine hands back after a first death flips the filing status.
const singleBrackets: BracketTier[] = [
  { from: 0, to: 11_600, rate: 0.1 },
  { from: 11_600, to: 47_150, rate: 0.12 },
  { from: 47_150, to: 100_525, rate: 0.22 },
  { from: 100_525, to: 191_950, rate: 0.24 },
  { from: 191_950, to: null, rate: 0.37 },
];

function tierFor(base: number, brackets: BracketTier[]): BracketTier {
  return brackets.find((t) => t.to == null || base < t.to) ?? brackets[brackets.length - 1];
}

function makeTaxResult(
  incomeTaxBase: number,
  brackets: BracketTier[],
  opts: { amtAdditional?: number; nextDollarFederalRate?: number } = {},
): TaxResult {
  const tier = tierFor(incomeTaxBase, brackets);
  return {
    flow: { incomeTaxBase, amtAdditional: opts.amtAdditional ?? 0 } as TaxResult["flow"],
    diag: {
      marginalFederalRate: tier.rate,
      marginalBracketTier: tier,
      incomeBracketsForFiling: brackets,
      effectiveFederalRate: 0,
      nextDollarFederalRate: opts.nextDollarFederalRate,
    } as TaxResult["diag"],
  } as TaxResult;
}

function makeYear(
  year: number,
  base: number,
  brackets: BracketTier[] = mfjBrackets,
  extra: Partial<ProjectionYear> & {
    amtAdditional?: number;
    nextDollarFederalRate?: number;
  } = {},
): ProjectionYear {
  const { amtAdditional, nextDollarFederalRate, ...overrides } = extra;
  return makeBareYear({
    year,
    taxResult: makeTaxResult(base, brackets, { amtAdditional, nextDollarFederalRate }),
    ...overrides,
  });
}

const conversion = (taxable: number, gross = taxable) => [
  { id: "rc1", name: "Roth conversion", gross, taxable, requested: gross, limitedBy: null },
];

describe("buildBracketFillModel", () => {
  it("skips years with no tax result, so bars line up with the table rows", () => {
    const model = buildBracketFillModel([
      makeYear(2026, 100_000),
      makeBareYear({ year: 2027 }),
      makeYear(2028, 110_000),
    ]);
    expect(model.years.map((y) => y.year)).toEqual([2026, 2028]);
  });

  it("splits the income tax base into other income and the taxable Roth conversion", () => {
    const [y] = buildBracketFillModel([
      makeYear(2026, 150_000, mfjBrackets, { rothConversions: conversion(50_000, 60_000) }),
    ]).years;
    expect(y.otherIncome).toBe(100_000);
    expect(y.conversion).toBe(50_000);
    expect(y.otherIncome + y.conversion).toBe(150_000);
  });

  it("caps the conversion slice at the base, so the stack never exceeds the income tax base", () => {
    // Deductions ate part of the conversion: base is smaller than the taxable conversion.
    const [y] = buildBracketFillModel([
      makeYear(2026, 30_000, mfjBrackets, { rothConversions: conversion(50_000) }),
    ]).years;
    expect(y.conversion).toBe(30_000);
    expect(y.otherIncome).toBe(0);
  });

  it("draws no conversion slice in a year without one", () => {
    const [y] = buildBracketFillModel([makeYear(2026, 80_000)]).years;
    expect(y.conversion).toBe(0);
    expect(y.otherIncome).toBe(80_000);
  });

  it("carries each year's own bracket ladder, so a filing-status flip shows the ceilings halving", () => {
    const model = buildBracketFillModel([
      makeYear(2045, 120_000, mfjBrackets),
      makeYear(2046, 120_000, singleBrackets),
    ]);
    expect(model.years[0].tiers).toBe(mfjBrackets);
    expect(model.years[1].tiers).toBe(singleBrackets);
  });

  it("sets the y ceiling just above the filled tier's top, so the headroom gap is visible", () => {
    // Income sits in the 22% tier (ceiling 201,050). The chart should show the
    // whole 22% band plus a sliver of 24% — not the entire 24% band, which
    // would squash the bars into the bottom third.
    const model = buildBracketFillModel([makeYear(2026, 120_000)]);
    expect(model.yMax).toBeGreaterThan(201_050);
    expect(model.yMax).toBeLessThan(260_000);
    // Quarter steps of the magnitude at $100k+: 225k, 250k, …
    expect(model.yMax % 25_000).toBe(0);
  });

  it("uses the tallest ceiling across all years", () => {
    const model = buildBracketFillModel([
      makeYear(2026, 120_000), // 22% → 201,050
      makeYear(2027, 250_000), // 24% → 383,900
    ]);
    expect(model.yMax).toBeGreaterThan(383_900);
  });

  it("in the top tier, which has no ceiling, leaves room above the tallest bar", () => {
    const model = buildBracketFillModel([makeYear(2026, 500_000)]);
    expect(model.yMax).toBeGreaterThan(500_000);
    expect(model.yMax).toBeLessThan(650_000);
  });

  it("ranks every distinct bracket rate seen across the projection, lowest first", () => {
    const model = buildBracketFillModel([
      makeYear(2026, 120_000, mfjBrackets),
      makeYear(2027, 120_000, singleBrackets),
    ]);
    expect(model.rates).toEqual([0.1, 0.12, 0.22, 0.24, 0.37]);
  });

  it("exposes the table row for the tooltip — bracket, room used, room left, AMT", () => {
    const model = buildBracketFillModel([
      makeYear(2026, 120_000),
      makeYear(2027, 120_000, mfjBrackets, { amtAdditional: 5_000, nextDollarFederalRate: 0.28 }),
    ]);
    const [ordinary, amt] = model.years;
    expect(ordinary.row.marginalRate).toBe(0.22);
    expect(ordinary.row.intoBracket).toBe(120_000 - 94_300);
    expect(ordinary.row.remainingInBracket).toBe(201_050 - 120_000);
    expect(ordinary.row.amtApplies).toBe(false);

    expect(amt.row.amtApplies).toBe(true);
    expect(amt.row.remainingInBracket).toBeNull();
    expect(amt.row.nextDollarRate).toBe(0.28);
  });

  it("returns an empty model, not a throw, when no year has a tax result", () => {
    const model = buildBracketFillModel([makeBareYear({ year: 2026 })]);
    expect(model.years).toEqual([]);
    expect(model.rates).toEqual([]);
    expect(model.yMax).toBe(0);
  });
});
