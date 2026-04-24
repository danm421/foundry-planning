import { describe, it, expect } from "vitest";
import { computeAlerts, MC_WARN_THRESHOLD, STALE_CLIENT_DATA_DAYS } from "@/lib/alerts";

const todayIso = new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

type ClientArg = Parameters<typeof computeAlerts>[0];
type ProjectionArg = Parameters<typeof computeAlerts>[1];

const baseClient: ClientArg = { id: "c1", updatedAt: todayIso };
const baseProjection: ProjectionArg = {
  monteCarloSuccess: 0.9,
  liquidPortfolio: 1_000_000,
  currentYearNetOutflow: 100_000,
  minNetWorth: 5_000_000,
};

describe("computeAlerts", () => {
  it("returns empty when all green", () => {
    expect(computeAlerts(baseClient, baseProjection)).toEqual([]);
  });

  it("mc-below-threshold: warning at 74%", () => {
    const alerts = computeAlerts(baseClient, { ...baseProjection, monteCarloSuccess: 0.74 });
    expect(alerts.find((a) => a.id === "mc-below-threshold")?.severity).toBe("warning");
  });

  it("mc-below-threshold: critical at 59%", () => {
    const alerts = computeAlerts(baseClient, { ...baseProjection, monteCarloSuccess: 0.59 });
    expect(alerts.find((a) => a.id === "mc-below-threshold")?.severity).toBe("critical");
  });

  it("mc-below-threshold does NOT fire at exactly 75%", () => {
    expect(
      computeAlerts(baseClient, { ...baseProjection, monteCarloSuccess: MC_WARN_THRESHOLD }),
    ).toEqual([]);
  });

  it("liquidity-runway-low fires when runway < 3y", () => {
    const alerts = computeAlerts(baseClient, {
      ...baseProjection,
      liquidPortfolio: 200_000,
      currentYearNetOutflow: 100_000, // runway = 2y
    });
    expect(alerts.find((a) => a.id === "liquidity-runway-low")).toBeTruthy();
  });

  it("liquidity-runway-low does NOT fire when outflow is zero or negative", () => {
    const alerts = computeAlerts(baseClient, {
      ...baseProjection,
      liquidPortfolio: 1_000,
      currentYearNetOutflow: 0,
    });
    expect(alerts.find((a) => a.id === "liquidity-runway-low")).toBeFalsy();
  });

  it("negative-net-worth-projected fires critical", () => {
    const alerts = computeAlerts(baseClient, { ...baseProjection, minNetWorth: -1 });
    expect(alerts.find((a) => a.id === "negative-net-worth-projected")?.severity).toBe("critical");
  });

  it("stale-client-data fires warning past 90 days", () => {
    const alerts = computeAlerts({ ...baseClient, updatedAt: daysAgo(STALE_CLIENT_DATA_DAYS + 1) }, baseProjection);
    expect(alerts.find((a) => a.id === "stale-client-data")?.severity).toBe("warning");
  });
});
