/**
 * The ONE place the plan decides whether equity has been held long enough.
 *
 * These tests pin two separate things and it matters which is which:
 *   1. the RULE (whole-year, conservative) — deliberate, and G8 keeps it once
 *      the inputs are real dates;
 *   2. the PROXY's known legal divergence — characterization tests, explicitly
 *      named as wrong, so G8 cannot land without updating them.
 */
import { describe, it, expect } from "vitest";
import {
  isQualifyingIsoDisposition,
  isLongTermHolding,
  assumedPrePlanAcquisitionYear,
} from "../holding-period";

describe("isQualifyingIsoDisposition — IRC §422(a)(1) on whole years", () => {
  // Both legs must clear. grant 2026, exercised 2027.
  const at = (dispositionYear: number) =>
    isQualifyingIsoDisposition({ grantYear: 2026, exerciseYear: 2027, dispositionYear });

  it("is false below the boundary and true at it", () => {
    expect(at(2028)).toBe(false); // 2y from grant, 1y from exercise — neither leg certain
    expect(at(2029)).toBe(true); // 3y from grant, 2y from exercise — both certain
    expect(at(2030)).toBe(true);
  });

  it("needs BOTH legs, not either", () => {
    // Grant leg clears (4y), exercise leg does not (1y): exercised late.
    expect(isQualifyingIsoDisposition({ grantYear: 2026, exerciseYear: 2029, dispositionYear: 2030 })).toBe(false);
    // Exercise leg clears (3y), grant leg does not (2y): impossible in practice
    // (exercise cannot precede grant) but the AND must still be an AND.
    expect(isQualifyingIsoDisposition({ grantYear: 2026, exerciseYear: 2025, dispositionYear: 2028 })).toBe(false);
  });

  it("KNOWN DIVERGENCE (audit F26/F27, fixed by G8): calls a legally qualifying sale disqualifying", () => {
    // Granted 1 Feb 2026, exercised 1 Mar 2027, sold 1 Dec 2029 is >2y from
    // grant and >1y from exercise — a QUALIFYING disposition under §422(a)(1).
    // Stored as (2026, 2027, 2029) the rule agrees. But move the sale to
    // 1 Jun 2028: still >1y from exercise, and >2y from grant — still
    // qualifying in law, and the plan says no, because 2028−2026 = 2.
    expect(isQualifyingIsoDisposition({ grantYear: 2026, exerciseYear: 2027, dispositionYear: 2028 })).toBe(false);
  });
});

describe("isLongTermHolding — the >1-year test on whole years", () => {
  it("is false at a one-year gap and true at two", () => {
    expect(isLongTermHolding(2027, 2027)).toBe(false);
    expect(isLongTermHolding(2027, 2028)).toBe(false);
    expect(isLongTermHolding(2027, 2029)).toBe(true);
  });

  it("KNOWN DIVERGENCE (audit F26/F27, fixed by G8): 13 months reads as short-term", () => {
    // Vest 1 Feb 2027, sell 1 Mar 2028 — 13 months, unambiguously long-term
    // under §1222(3). Stored as (2027, 2028) the plan taxes it short-term.
    expect(isLongTermHolding(2027, 2028)).toBe(false);
  });
});

describe("assumedPrePlanAcquisitionYear", () => {
  it("is two years before the plan starts", () => {
    expect(assumedPrePlanAcquisitionYear(2026)).toBe(2024);
    expect(assumedPrePlanAcquisitionYear(2031)).toBe(2029);
  });
});
