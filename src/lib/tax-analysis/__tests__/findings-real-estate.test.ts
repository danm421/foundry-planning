import { describe, it, expect } from "vitest";
import { rentalCashVsPaper, suspendedPassiveLoss } from "../findings/real-estate";
import { formatLineRefs } from "../findings/line-refs";
import { findingCtx, landlordSingle, retireeMfj } from "./fixtures";

describe("rentalCashVsPaper", () => {
  it("reproduces the spec's worked example from the real filed return", () => {
    const f = rentalCashVsPaper(findingCtx(landlordSingle(), { primaryAge: 41 }))!;
    expect(f.category).toBe("real-estate");
    expect(f.severity).toBe("opportunity");
    expect(f.numbers.cashFlow).toBe(2272);   // −6,141 + 8,413
    expect(f.numbers.depreciation).toBe(8413);
    expect(f.numbers.net).toBe(-6141);
    // The impact IS the depreciation — the cash the net understates.
    expect(f.estimatedImpact).toBe(8413);
    expect(f.headline).toContain("$2,272");
    expect(f.whatTheReturnShows).toContain("$19,600");
    expect(f.whyItMatters).toContain("25%"); // §1250 recapture
    expect(formatLineRefs(f.lineRefs)).toBe(
      "Schedule E line 3 · line 18 · line 20 · Schedule 1 line 5",
    );
  });

  it("takes its net from the shared activity rows, never from gross minus expenses", () => {
    const facts = landlordSingle();
    // §280A / personal-use case: the filed net is NOT 19,600 − 25,741.
    facts.income.scheduleENet = -1200;
    const f = rentalCashVsPaper(findingCtx(facts, { primaryAge: 41 }))!;
    expect(f.numbers.net).toBe(-1200);
    expect(f.numbers.cashFlow).toBe(7213); // −1,200 + 8,413
  });

  it("stays silent for a return with no rental at all", () => {
    expect(rentalCashVsPaper(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))).toBeNull();
  });

  it("stays silent when the rental reports no depreciation", () => {
    const facts = landlordSingle();
    facts.income.scheduleE!.depreciation = null;
    expect(rentalCashVsPaper(findingCtx(facts, { primaryAge: 41 }))).toBeNull();
  });
});

describe("suspendedPassiveLoss", () => {
  it("prices the carried-forward loss at the marginal rate", () => {
    const facts = landlordSingle();
    facts.income.scheduleE!.suspendedPassiveLoss = 12400;
    const f = suspendedPassiveLoss(findingCtx(facts, { primaryAge: 41 }))!;
    expect(f.category).toBe("real-estate");
    expect(f.severity).toBe("info");
    expect(f.numbers.suspendedLoss).toBe(12400);
    expect(f.estimatedImpact).toBeCloseTo(12400 * f.numbers.marginalRate, 6);
    expect(f.whatToConsider).toContain("disposition");
  });

  it("stays silent on the unmutated fixture — suspendedPassiveLoss is 0 there", () => {
    expect(suspendedPassiveLoss(findingCtx(landlordSingle(), { primaryAge: 41 }))).toBeNull();
  });
});
