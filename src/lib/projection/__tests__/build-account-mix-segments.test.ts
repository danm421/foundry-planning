import { describe, it, expect } from "vitest";
import { buildAccountMixSegments } from "../build-account-mix-segments";
import type { Reinvestment } from "@/engine/types";

const EQ = [{ assetClassId: "eq", weight: 1 }];
const BAL = [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }];

function ri(partial: Partial<Reinvestment>): Reinvestment {
  return {
    id: "ri-1", name: "Switch", accountIds: ["acc-1"], year: 2035,
    newGrowthRate: 0.05, realizeTaxesOnSwitch: false, soldFractionByAccount: {},
    ...partial,
  };
}

describe("buildAccountMixSegments", () => {
  it("emits a single base segment (fromYear 0) when there are no reinvestments", () => {
    const out = buildAccountMixSegments({
      baseMixByAccount: new Map([["acc-1", EQ]]),
      reinvestments: [],
      resolvePortfolioMix: () => [],
    });
    expect(out).toEqual([{ accountId: "acc-1", segments: [{ fromYear: 0, mix: EQ }] }]);
  });

  it("appends a model-portfolio reinvestment segment at ri.year with the target mix", () => {
    const out = buildAccountMixSegments({
      baseMixByAccount: new Map([["acc-1", EQ]]),
      reinvestments: [ri({ targetType: "model_portfolio", modelPortfolioId: "mp-1", year: 2035 })],
      resolvePortfolioMix: (id) => (id === "mp-1" ? BAL : []),
    });
    const segs = out.find((o) => o.accountId === "acc-1")!.segments;
    expect(segs).toContainEqual({ fromYear: 0, mix: EQ });
    expect(segs).toContainEqual({ fromYear: 2035, mix: BAL });
  });

  it("appends an EMPTY-mix segment for a custom-rate reinvestment (fixed-rate fallback)", () => {
    const out = buildAccountMixSegments({
      baseMixByAccount: new Map([["acc-1", EQ]]),
      reinvestments: [ri({ targetType: "custom", year: 2035 })],
      resolvePortfolioMix: () => [],
    });
    const segs = out.find((o) => o.accountId === "acc-1")!.segments;
    expect(segs).toContainEqual({ fromYear: 2035, mix: [] });
  });

  it("handles an account with only a reinvestment segment (no base mix)", () => {
    const out = buildAccountMixSegments({
      baseMixByAccount: new Map(),
      reinvestments: [ri({ accountIds: ["acc-2"], targetType: "model_portfolio", modelPortfolioId: "mp-1", year: 2030 })],
      resolvePortfolioMix: () => BAL,
    });
    expect(out).toEqual([{ accountId: "acc-2", segments: [{ fromYear: 2030, mix: BAL }] }]);
  });

  it("ignores disabled reinvestments", () => {
    const out = buildAccountMixSegments({
      baseMixByAccount: new Map([["acc-1", EQ]]),
      reinvestments: [ri({ enabled: false, targetType: "model_portfolio", modelPortfolioId: "mp-1" })],
      resolvePortfolioMix: () => BAL,
    });
    expect(out.find((o) => o.accountId === "acc-1")!.segments).toEqual([{ fromYear: 0, mix: EQ }]);
  });
});
