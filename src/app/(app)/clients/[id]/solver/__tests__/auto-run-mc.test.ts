import { describe, it, expect } from "vitest";
import { shouldAutoRunMc, AUTO_RUN_DEBOUNCE_MS } from "../auto-run-mc";
import type { ScenarioGaugeDisplayState } from "../scenario-gauge-state";

describe("shouldAutoRunMc", () => {
  it("fires when the gauge is stale and no solve is running", () => {
    expect(shouldAutoRunMc({ state: "stale", solveActive: false })).toBe(true);
  });

  it("does not fire on error — auto-retrying a failing run would loop forever", () => {
    expect(shouldAutoRunMc({ state: "error", solveActive: false })).toBe(false);
  });

  it("does not fire while a run is already in flight (single-in-flight)", () => {
    expect(shouldAutoRunMc({ state: "computing", solveActive: false })).toBe(false);
  });

  it.each<ScenarioGaugeDisplayState>(["idle", "ready"])(
    "does not fire when %s",
    (state) => {
      expect(shouldAutoRunMc({ state, solveActive: false })).toBe(false);
    },
  );

  it("is suppressed while a deterministic solve owns the run", () => {
    // A solve mints draft accounts mid-flight; relaunching the gauge MC would
    // contend with it for the function instance's CPU (see use-solver-mc.ts).
    expect(shouldAutoRunMc({ state: "stale", solveActive: true })).toBe(false);
  });

  it("debounces at 2s", () => {
    expect(AUTO_RUN_DEBOUNCE_MS).toBe(2000);
  });
});
