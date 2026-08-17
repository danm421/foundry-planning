/**
 * The ONE place the plan decides whether equity has been held long enough.
 *
 * G8 replaced the whole-year proxy with the real statutory tests. The two cases
 * G7 marked `KNOWN DIVERGENCE (audit F26/F27, fixed by G8)` now assert the
 * legally correct answer — they are the reason this module exists.
 */
import { describe, it, expect } from "vitest";
import { isQualifyingIsoDisposition, isLongTermHolding } from "../holding-period";

describe("isQualifyingIsoDisposition — IRC §422(a)(1) on real dates", () => {
  // Granted 1 Feb 2026, exercised 1 Mar 2027.
  const at = (dispositionDate: string) =>
    isQualifyingIsoDisposition({
      grantDate: "2026-02-01",
      exerciseDate: "2027-03-01",
      dispositionDate,
    });

  it("was the F26/F27 divergence: a June-2028 sale IS qualifying", () => {
    // >2y from grant (Feb 2028) and >1y from exercise (Mar 2028). The whole-year
    // rule said false because 2028 − 2026 = 2. It is true.
    expect(at("2028-06-01")).toBe(true);
  });

  it("needs BOTH legs strictly cleared", () => {
    expect(at("2028-01-31")).toBe(false); // grant leg not yet 2y
    expect(at("2028-02-15")).toBe(false); // grant leg clear, exercise leg 11.5m
    expect(at("2028-03-02")).toBe(true); // both cleared
  });

  it("is strict, not inclusive — exactly two years from grant is NOT more than two", () => {
    expect(
      isQualifyingIsoDisposition({
        grantDate: "2026-02-01",
        exerciseDate: "2026-02-01",
        dispositionDate: "2028-02-01",
      }),
    ).toBe(false);
    expect(
      isQualifyingIsoDisposition({
        grantDate: "2026-02-01",
        exerciseDate: "2026-02-01",
        dispositionDate: "2028-02-02",
      }),
    ).toBe(true);
  });

  it("fails when the exercise leg alone is short", () => {
    expect(
      isQualifyingIsoDisposition({
        grantDate: "2026-02-01",
        exerciseDate: "2029-10-01",
        dispositionDate: "2030-01-01",
      }),
    ).toBe(false);
  });
});

describe("isLongTermHolding — IRC §1222(3) on real dates", () => {
  it("was the F26/F27 divergence: 13 months IS long-term", () => {
    // Vest 1 Feb 2027, sell 1 Mar 2028. The whole-year rule taxed this short-term.
    expect(isLongTermHolding("2027-02-01", "2028-03-01")).toBe(true);
  });

  it("is strict at exactly one year", () => {
    expect(isLongTermHolding("2027-02-01", "2028-02-01")).toBe(false);
    expect(isLongTermHolding("2027-02-01", "2028-02-02")).toBe(true);
  });

  it("is false for a same-day and a backwards sale", () => {
    expect(isLongTermHolding("2027-02-01", "2027-02-01")).toBe(false);
    expect(isLongTermHolding("2027-02-01", "2026-12-01")).toBe(false);
  });
});
