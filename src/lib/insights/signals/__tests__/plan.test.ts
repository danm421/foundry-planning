import { describe, it, expect } from "vitest";
import { planSignals } from "../plan";
import { signalInputFixture } from "./fixture";

const ids = (i: Parameters<typeof planSignals>[0]) => planSignals(i).map((s) => s.id);

describe("planSignals", () => {
  it("fires nothing for a healthy plan", () => {
    expect(planSignals(signalInputFixture())).toEqual([]);
  });

  it("fires confidence_low as watch below 75%", () => {
    const i = signalInputFixture();
    i.plan.mcSuccessRate = 0.7;
    const s = planSignals(i).find((x) => x.id === "plan.confidence_low");
    expect(s?.severity).toBe("watch");
  });

  it("escalates confidence_low to critical below 60%", () => {
    const i = signalInputFixture();
    i.plan.mcSuccessRate = 0.55;
    const s = planSignals(i).find((x) => x.id === "plan.confidence_low");
    expect(s?.severity).toBe("critical");
  });

  it("does not fire confidence_low when Monte Carlo is unavailable", () => {
    const i = signalInputFixture();
    i.plan.mcSuccessRate = null;
    expect(ids(i)).not.toContain("plan.confidence_low");
  });

  it("fires liquidity_runway_low under 3 years of outflow", () => {
    const i = signalInputFixture();
    i.plan.liquidPortfolio = 100_000;
    i.plan.currentYearNetOutflow = 50_000; // 2 years
    expect(ids(i)).toContain("plan.liquidity_runway_low");
  });

  it("does not fire liquidity_runway_low when there is no net outflow", () => {
    const i = signalInputFixture();
    i.plan.liquidPortfolio = 0;
    i.plan.currentYearNetOutflow = 0; // division guard
    expect(ids(i)).not.toContain("plan.liquidity_runway_low");
  });

  it("fires negative_net_worth when any year is projected at or below zero", () => {
    const i = signalInputFixture();
    i.plan.minNetWorth = -1;
    expect(ids(i)).toContain("plan.negative_net_worth");
  });

  it("fires funding_shortfall below a funding score of 1.0", () => {
    const i = signalInputFixture();
    i.plan.fundingScore = 0.85;
    expect(ids(i)).toContain("plan.funding_shortfall");
  });
});
