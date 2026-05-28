import { describe, it, expect } from "vitest";
import { detectReinvestmentEvents } from "../../detectors/reinvestments";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectReinvestmentEvents", () => {
  it("emits a strategy event for a reinvestment in its scheduled year", () => {
    const data = buildClientData();
    data.reinvestments = [
      {
        id: "rein-1",
        name: "Glide-path shift to 60/40",
        accountIds: ["acct-brokerage"],
        year: 2035,
        newGrowthRate: 0.055,
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "acct-brokerage": 0.5 },
      },
    ];
    const projection = runProjection(data);
    const events = detectReinvestmentEvents(data, projection);
    const ev = events.find((e) => e.id === "strategy:reinvestment:rein-1");
    expect(ev).toBeDefined();
    expect(ev!.year).toBe(2035);
    expect(ev!.category).toBe("strategy");
    expect(ev!.title).toBe("Glide-path shift to 60/40");
    expect(ev!.supportingFigure).toBeDefined();
  });

  it("falls back to growth-rate label when balance lookup is unavailable", () => {
    const data = buildClientData();
    data.reinvestments = [
      {
        id: "rein-2",
        name: "Custom growth bump",
        accountIds: ["acct-unknown"],
        year: 2030,
        newGrowthRate: 0.07,
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "acct-unknown": 1 },
      },
    ];
    const projection = runProjection(data);
    const events = detectReinvestmentEvents(data, projection);
    const ev = events.find((e) => e.id === "strategy:reinvestment:rein-2");
    expect(ev).toBeDefined();
    expect(ev!.supportingFigure).toMatch(/7(\.0)?%/);
  });

  it("skips reinvestments scheduled outside the projection window", () => {
    const data = buildClientData();
    data.reinvestments = [
      {
        id: "rein-late",
        name: "Future shift",
        accountIds: ["acct-brokerage"],
        year: 2100,
        newGrowthRate: 0.06,
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "acct-brokerage": 0.5 },
      },
    ];
    const projection = runProjection(data);
    const events = detectReinvestmentEvents(data, projection);
    expect(events.find((e) => e.id === "strategy:reinvestment:rein-late")).toBeUndefined();
  });
});
