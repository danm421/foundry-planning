import { describe, it, expect } from "vitest";
import type { StockOptionPlan } from "@/engine/equity/types";
import { equityPlanLabel } from "../equity-plan-label";

type PlanFixture = Pick<StockOptionPlan, "ticker" | "accountId" | "grants">;

function plan(overrides: Partial<PlanFixture> & { accountId: string }): PlanFixture {
  return {
    ticker: null,
    grants: [],
    ...overrides,
  };
}

function grant(grantType: "rsu" | "nqso" | "iso") {
  return { grantType } as Pick<StockOptionPlan["grants"][number], "grantType"> as never;
}

describe("equityPlanLabel", () => {
  it("homogeneous rsu grants → '<ticker> RSU'", () => {
    const p = plan({ accountId: "so-1", ticker: "TSLA", grants: [grant("rsu"), grant("rsu")] });
    expect(equityPlanLabel(p)).toBe("TSLA RSU");
  });

  it("homogeneous nqso grants → '<ticker> NQSO'", () => {
    const p = plan({ accountId: "so-2", ticker: "TSLA", grants: [grant("nqso")] });
    expect(equityPlanLabel(p)).toBe("TSLA NQSO");
  });

  it("homogeneous iso grants → '<ticker> ISO'", () => {
    const p = plan({ accountId: "so-3", ticker: "TSLA", grants: [grant("iso")] });
    expect(equityPlanLabel(p)).toBe("TSLA ISO");
  });

  it("mixed rsu+iso grants → '<ticker> equity'", () => {
    const p = plan({ accountId: "so-4", ticker: "TSLA", grants: [grant("rsu"), grant("iso")] });
    expect(equityPlanLabel(p)).toBe("TSLA equity");
  });

  it("empty grants → '<ticker> equity'", () => {
    const p = plan({ accountId: "so-5", ticker: "TSLA", grants: [] });
    expect(equityPlanLabel(p)).toBe("TSLA equity");
  });

  it("null ticker falls back to accountId", () => {
    const p = plan({ accountId: "so-1", ticker: null, grants: [grant("iso")] });
    expect(equityPlanLabel(p)).toBe("so-1 ISO");
  });
});
