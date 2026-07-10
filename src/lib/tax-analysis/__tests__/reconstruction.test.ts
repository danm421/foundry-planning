import { describe, it, expect } from "vitest";
import { runReconstruction } from "../reconstruction";
import { runCalc, type AdapterContext } from "../adapter";
import { params2025, retireeMfj } from "./fixtures";

const ctx: AdapterContext = { taxParams: params2025, primaryAge: 72, spouseAge: 72 };

describe("runReconstruction", () => {
  it("is within tolerance when filed tax equals the engine's own answer", () => {
    const base = retireeMfj();
    const engine = runCalc(base, ctx)!;
    const filed =
      engine.flow.regularTaxCalc +
      engine.flow.capitalGainsTax +
      engine.flow.amtAdditional;
    base.tax.taxBeforeCredits = Math.round(filed);
    base.tax.amt = 0;
    const check = runReconstruction(base, ctx);
    expect(check.withinTolerance).toBe(true);
    expect(Math.abs(check.delta!)).toBeLessThanOrEqual(1);
  });

  it("flags a large mismatch", () => {
    const base = retireeMfj();
    base.tax.taxBeforeCredits = 5000; // wildly off
    const check = runReconstruction(base, ctx);
    expect(check.withinTolerance).toBe(false);
  });

  it("returns null tolerance when filed tax is missing", () => {
    const base = retireeMfj();
    base.tax.taxBeforeCredits = null;
    const check = runReconstruction(base, ctx);
    expect(check.withinTolerance).toBeNull();
    expect(check.filedPreCreditTax).toBeNull();
  });
});
