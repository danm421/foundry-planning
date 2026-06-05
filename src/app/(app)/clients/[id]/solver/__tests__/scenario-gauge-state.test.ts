import { describe, it, expect } from "vitest";
import { deriveScenarioGaugeState } from "../scenario-gauge-state";

const base = {
  mcStatus: "ready" as const,
  mcWorkingSuccess: 0.9,
  solvedPoS: null as number | null,
  editNonce: 2,
  mcEditNonce: 2 as number | null,
};

describe("deriveScenarioGaugeState", () => {
  it("is computing while an MC run is loading", () => {
    expect(deriveScenarioGaugeState({ ...base, mcStatus: "loading" })).toEqual({
      state: "computing",
      successPct: null,
    });
  });

  it("is ready showing a fresh solve PoS regardless of MC status", () => {
    expect(
      deriveScenarioGaugeState({ ...base, mcStatus: "idle", solvedPoS: 0.8 }),
    ).toEqual({ state: "ready", successPct: 0.8 });
  });

  it("prefers a fresh solve PoS over an MC error", () => {
    expect(
      deriveScenarioGaugeState({ ...base, mcStatus: "error", solvedPoS: 0.8 }),
    ).toEqual({ state: "ready", successPct: 0.8 });
  });

  it("is error when MC failed and there is no solve PoS", () => {
    expect(
      deriveScenarioGaugeState({ ...base, mcStatus: "error", solvedPoS: null }),
    ).toEqual({ state: "error", successPct: null });
  });

  it("is ready when the MC nonce matches the current edit nonce", () => {
    expect(deriveScenarioGaugeState({ ...base, editNonce: 2, mcEditNonce: 2 })).toEqual({
      state: "ready",
      successPct: 0.9,
    });
  });

  it("is stale (showing the last value) when edits postdate the MC run", () => {
    expect(deriveScenarioGaugeState({ ...base, editNonce: 3, mcEditNonce: 2 })).toEqual({
      state: "stale",
      successPct: 0.9,
    });
  });

  it("is idle before any MC run has been launched", () => {
    expect(
      deriveScenarioGaugeState({ ...base, mcStatus: "idle", mcEditNonce: null }),
    ).toEqual({ state: "idle", successPct: null });
  });
});
