import { describe, it, expect } from "vitest";
import { irmaaCliff, qcd } from "../observations/retirement";
import type { ObservationContext } from "../types";
import { runCalc } from "../adapter";
import { buildBracketMap } from "../bracket-map";
import { params2025, retireeMfj, singleNearIrmaa, highEarnerMfj } from "./fixtures";

function ctxFor(
  facts: ReturnType<typeof retireeMfj>,
  ages: { primaryAge: number | null; spouseAge: number | null },
): ObservationContext {
  return {
    facts, prior: null, params: params2025, irmaaParams: params2025, ...ages,
    calc: runCalc(facts, { taxParams: params2025, ...ages }),
    bracketMap: buildBracketMap(facts, params2025),
  };
}

describe("irmaaCliff", () => {
  it("warns a single filer $1,500 below the first cliff", () => {
    const o = irmaaCliff(ctxFor(singleNearIrmaa(), { primaryAge: 66, spouseAge: null }))!;
    expect(o.severity).toBe("watch");
    expect(o.numbers.tier).toBe(0);
    expect(o.numbers.distanceToNextCliff).toBe(1500);
    expect(o.body).toContain("2027"); // taxYear 2025 + 2-year lookback
  });

  it("reports the surcharge and drop-a-tier distance once inside a tier", () => {
    const f = singleNearIrmaa();
    f.income.agi = 140000; // tier 2 (133k–167k)
    const o = irmaaCliff(ctxFor(f, { primaryAge: 66, spouseAge: null }))!;
    expect(o.numbers.tier).toBe(2);
    expect(o.numbers.reductionToDropTier).toBe(140000 - 133000);
  });

  it("skips filers under 63", () => {
    expect(irmaaCliff(ctxFor(highEarnerMfj(), { primaryAge: 45, spouseAge: 44 }))).toBeNull();
  });
});

describe("qcd", () => {
  it("flags a 72-year-old standard-deduction filer with IRA distributions", () => {
    const o = qcd(ctxFor(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))!;
    expect(o.severity).toBe("opportunity");
    expect(o.body).toContain("qualified charitable distribution");
    // No Schedule A giving evidence on this return — intent must be conditional, not asserted.
    expect(o.body).toContain("If charitable giving is part of your plans");
    expect(o.body).not.toContain("charitable intent");
  });
  it("skips when nobody is 70+", () => {
    expect(qcd(ctxFor(retireeMfj(), { primaryAge: 68, spouseAge: 67 }))).toBeNull();
  });
  it("skips without IRA distributions", () => {
    const f = retireeMfj();
    f.income.iraDistributionsGross = 0;
    expect(qcd(ctxFor(f, { primaryAge: 72, spouseAge: 72 }))).toBeNull();
  });
});
