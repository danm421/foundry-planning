import { describe, it, expect } from "vitest";
import { sliceIntoBrackets, inferOrdinaryBrackets } from "../bracket-fill";
import type { BracketTier, TaxYearParameters } from "@/lib/tax/types";

const MFJ_BRACKETS: BracketTier[] = [
  { from: 0,      to: 23200,  rate: 0.10 },
  { from: 23200,  to: 94300,  rate: 0.12 },
  { from: 94300,  to: 201050, rate: 0.22 },
  { from: 201050, to: 383900, rate: 0.24 },
  { from: 383900, to: 487450, rate: 0.32 },
  { from: 487450, to: 731200, rate: 0.35 },
  { from: 731200, to: null,   rate: 0.37 },
];

const SINGLE_BRACKETS: BracketTier[] = [
  { from: 0,      to: 11600,  rate: 0.10 },
  { from: 11600,  to: 47150,  rate: 0.12 },
  { from: 47150,  to: null,   rate: 0.22 },
];

function mkParams(): TaxYearParameters {
  return {
    year: 2026,
    incomeBrackets: {
      married_joint: MFJ_BRACKETS,
      single: SINGLE_BRACKETS,
      head_of_household: SINGLE_BRACKETS,
      married_separate: SINGLE_BRACKETS,
    },
  } as TaxYearParameters;
}

describe("sliceIntoBrackets", () => {
  it("returns an empty array for zero income", () => {
    expect(sliceIntoBrackets(0, MFJ_BRACKETS)).toEqual([]);
  });

  it("fills only the bottom bracket when income < first cap", () => {
    expect(sliceIntoBrackets(10_000, MFJ_BRACKETS)).toEqual([
      { rate: 0.10, amount: 10_000 },
    ]);
  });

  it("fills the bottom two brackets when income straddles the 10/12 boundary", () => {
    expect(sliceIntoBrackets(50_000, MFJ_BRACKETS)).toEqual([
      { rate: 0.10, amount: 23_200 },
      { rate: 0.12, amount: 26_800 },
    ]);
  });

  it("fills into the open-top bracket when income exceeds the top cap", () => {
    const out = sliceIntoBrackets(1_000_000, MFJ_BRACKETS);
    expect(out[out.length - 1]).toEqual({ rate: 0.37, amount: 1_000_000 - 731_200 });
    expect(out.reduce((s, e) => s + e.amount, 0)).toBe(1_000_000);
  });

  it("negative or NaN income yields an empty array", () => {
    expect(sliceIntoBrackets(-1, MFJ_BRACKETS)).toEqual([]);
    expect(sliceIntoBrackets(Number.NaN, MFJ_BRACKETS)).toEqual([]);
  });
});

describe("inferOrdinaryBrackets", () => {
  it("returns the MFJ schedule when the marginal tier matches an MFJ entry", () => {
    const params = mkParams();
    const marginal: BracketTier = { from: 94300, to: 201050, rate: 0.22 };
    expect(inferOrdinaryBrackets(marginal, params)).toBe(MFJ_BRACKETS);
  });

  it("returns the single schedule when the marginal tier matches a single entry", () => {
    const params = mkParams();
    const marginal: BracketTier = { from: 47150, to: null, rate: 0.22 };
    expect(inferOrdinaryBrackets(marginal, params)).toBe(SINGLE_BRACKETS);
  });

  it("falls back to the MFJ schedule when no entry matches (defensive)", () => {
    const params = mkParams();
    const marginal: BracketTier = { from: 999999, to: null, rate: 0.99 };
    expect(inferOrdinaryBrackets(marginal, params)).toBe(MFJ_BRACKETS);
  });
});

import { bracketTopsByYear } from "../bracket-fill";
import type { ProjectionYear } from "@/engine";

function fakeYear(year: number, brackets: BracketTier[]): ProjectionYear {
  return {
    year,
    taxResult: {
      diag: {
        marginalBracketTier: brackets[0],
        bracketsUsed: { incomeBrackets: { married_joint: brackets } },
      },
    },
  } as never;
}

describe("bracketTopsByYear", () => {
  it("returns one series per rate, with year-aligned tops (skipping open-ended top tier)", () => {
    const years = [
      fakeYear(2026, [
        { from: 0, to: 100, rate: 0.10 },
        { from: 100, to: 200, rate: 0.12 },
        { from: 200, to: null, rate: 0.22 },
      ]),
      fakeYear(2027, [
        { from: 0, to: 110, rate: 0.10 },
        { from: 110, to: 220, rate: 0.12 },
        { from: 220, to: null, rate: 0.22 },
      ]),
    ];
    const out = bracketTopsByYear(years);
    expect(out.get(0.10)).toEqual([100, 110]);
    expect(out.get(0.12)).toEqual([200, 220]);
    expect(out.has(0.22)).toBe(false);
  });

  it("skips years with no taxResult by using NaN so chart.js leaves a gap", () => {
    const years = [
      fakeYear(2026, [
        { from: 0, to: 100, rate: 0.10 },
        { from: 100, to: null, rate: 0.12 },
      ]),
      { year: 2027 } as never,
    ];
    const out = bracketTopsByYear(years);
    const tops10 = out.get(0.10)!;
    expect(tops10[0]).toBe(100);
    expect(Number.isNaN(tops10[1])).toBe(true);
  });
});
