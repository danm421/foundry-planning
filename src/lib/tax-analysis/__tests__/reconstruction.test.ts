import { describe, it, expect } from "vitest";
import { runReconstruction, reconstructionNote } from "../reconstruction";
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
    const check = runReconstruction(base, engine);
    expect(check.withinTolerance).toBe(true);
    expect(Math.abs(check.delta!)).toBeLessThanOrEqual(1);
  });

  it("flags a large mismatch", () => {
    const base = retireeMfj();
    base.tax.taxBeforeCredits = 5000; // wildly off
    const check = runReconstruction(base, runCalc(base, ctx));
    expect(check.withinTolerance).toBe(false);
  });

  it("returns null tolerance when filed tax is missing", () => {
    const base = retireeMfj();
    base.tax.taxBeforeCredits = null;
    const check = runReconstruction(base, runCalc(base, ctx));
    expect(check.withinTolerance).toBeNull();
    expect(check.filedPreCreditTax).toBeNull();
  });
});

describe("runReconstruction — a filed AMT this model cannot reproduce", () => {
  // The adapter never passes an option spread or any other AMT preference — the
  // extraction schema has no field for one — so a return that paid AMT produces
  // a gap the MODEL created, not the document scan. The cross-check used to
  // compare against the filed AMT anyway and tell the advisor to "verify the
  // extracted figures", on a report that also renders as a client-facing PDF.
  function returnWithAmt(amt: number) {
    const base = retireeMfj();
    const engine = runCalc(base, ctx)!;
    // The rest of the return reconstructs exactly; only AMT is unexplained.
    base.tax.taxBeforeCredits = Math.round(
      engine.flow.regularTaxCalc + engine.flow.capitalGainsTax + engine.flow.amtAdditional,
    );
    base.tax.amt = amt;
    return { base, engine };
  }

  it("drops AMT from BOTH sides so the rest of the return is still checked", () => {
    const { base, engine } = returnWithAmt(235_597);
    const check = runReconstruction(base, engine);
    expect(check.amtExcluded).toBe(true);
    expect(check.filedAmt).toBe(235_597);
    // Neither side carries the 235,597 — so the remainder is genuinely compared
    // rather than swamped, and it matches.
    expect(check.filedPreCreditTax).toBe(base.tax.taxBeforeCredits);
    expect(check.withinTolerance).toBe(true);
  });

  it("says the filed AMT is not reproduced and does NOT blame the extraction", () => {
    const { base, engine } = returnWithAmt(235_597);
    const note = reconstructionNote(runReconstruction(base, engine));
    expect(note).toMatch(/not reproduced/i);
    expect(note).toMatch(/alternative minimum tax/i);
    expect(note).not.toMatch(/verify the extracted figures/i);
  });

  it("still flags a REAL mismatch, and still excludes the AMT from it", () => {
    // The exclusion must not swallow a genuine discrepancy elsewhere on the
    // return — "verify the extracted figures" is the right sentence when the gap
    // is one the extraction could actually explain.
    const { base, engine } = returnWithAmt(235_597);
    base.tax.taxBeforeCredits = 5_000; // wildly off, independent of the AMT
    const check = runReconstruction(base, engine);
    expect(check.amtExcluded).toBe(true);
    expect(check.withinTolerance).toBe(false);
    const note = reconstructionNote(check);
    expect(note).toMatch(/verify the extracted figures/i);
    expect(note).toMatch(/not reproduced/i);
  });

  it("still excludes when the model coughs up a LITTLE AMT of its own", () => {
    // ⚠️ The model can produce AMT from the standard-deduction or SALT add-back
    // with no preference item anywhere. Gating the exclusion on "the model
    // produced none" would hand those returns the old five-figure delta and the
    // "verify the extracted figures" sentence straight back, on an arbitrary
    // subset — so the exclusion keys on the FILED figure alone.
    const { base, engine } = returnWithAmt(235_597);
    const withOwnAmt = { ...engine, flow: { ...engine.flow, amtAdditional: 1_200 } };
    const check = runReconstruction(base, withOwnAmt);
    expect(check.amtExcluded).toBe(true);
    expect(reconstructionNote(check)).not.toMatch(/verify the extracted figures/i);
  });

  it("does not dangle the AMT sentence when no cross-check ran at all", () => {
    // With no filed pre-credit tax there is no comparison, so there is nothing
    // for AMT to have been "excluded from".
    const base = retireeMfj();
    base.tax.taxBeforeCredits = null;
    base.tax.amt = 235_597;
    const check = runReconstruction(base, runCalc(base, ctx));
    expect(check.withinTolerance).toBeNull();
    expect(reconstructionNote(check)).toBe(
      "This analysis is informational, based on the return as provided, and is not tax advice.",
    );
  });

  it("leaves a return with no AMT exactly as it was", () => {
    const base = retireeMfj();
    const engine = runCalc(base, ctx)!;
    base.tax.taxBeforeCredits = Math.round(
      engine.flow.regularTaxCalc + engine.flow.capitalGainsTax + engine.flow.amtAdditional,
    );
    base.tax.amt = 0;
    const check = runReconstruction(base, engine);
    expect(check.amtExcluded).toBe(false);
    expect(reconstructionNote(check)).not.toMatch(/alternative minimum tax/i);
  });
});
