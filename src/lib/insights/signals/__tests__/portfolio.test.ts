import { describe, it, expect } from "vitest";
import { portfolioSignals } from "../portfolio";
import { signalInputFixture } from "./fixture";

const ids = (i: Parameters<typeof portfolioSignals>[0]) =>
  portfolioSignals(i).map((s) => s.id);

describe("portfolioSignals", () => {
  it("fires nothing for a clean portfolio", () => {
    expect(portfolioSignals(signalInputFixture())).toEqual([]);
  });

  it("fires cash_drag above 10% cash", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.25;
    expect(ids(i)).toContain("portfolio.cash_drag");
  });

  it("prices cash drag at the CMA spread on the EXCESS cash only", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.20;         // 10 points above the threshold
    i.portfolio.liquidPortfolio = 1_000_000;
    i.portfolio.cashReturn = 0.01;
    i.portfolio.equityReturn = 0.06;
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.cash_drag");
    // excess = (0.20 - 0.10) * 1_000_000 = 100_000; spread = 0.05 → 5_000
    expect(s!.estimatedImpact).toBeCloseTo(5_000, 6);
  });

  it("does not fire cash_drag exactly at the threshold", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.10;
    expect(ids(i)).not.toContain("portfolio.cash_drag");
  });

  it("does not fire cash_drag on an empty portfolio, even well above the cash threshold", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.5;
    i.portfolio.liquidPortfolio = 0;
    expect(ids(i)).not.toContain("portfolio.cash_drag");
  });

  it("fires concentration as watch above 10% of the liquid portfolio", () => {
    const i = signalInputFixture();
    i.portfolio.liquidPortfolio = 1_000_000;
    i.portfolio.largestPosition = { label: "TSLA", value: 150_000 };
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("watch");
    expect(s!.detail).toContain("TSLA");
  });

  it("does not fire concentration exactly at the watch threshold", () => {
    const i = signalInputFixture();
    i.portfolio.liquidPortfolio = 1_000_000;
    i.portfolio.largestPosition = { label: "TSLA", value: 100_000 }; // exactly 10%
    expect(ids(i)).not.toContain("portfolio.concentration");
  });

  it("escalates concentration to critical above 20%", () => {
    const i = signalInputFixture();
    i.portfolio.liquidPortfolio = 1_000_000;
    i.portfolio.largestPosition = { label: "TSLA", value: 300_000 };
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("critical");
  });

  it("stays watch, not critical, exactly at the critical threshold", () => {
    const i = signalInputFixture();
    i.portfolio.liquidPortfolio = 1_000_000;
    i.portfolio.largestPosition = { label: "TSLA", value: 200_000 }; // exactly 20%
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("watch");
  });

  it("does not fire concentration when no holdings are known", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = null;
    expect(ids(i)).not.toContain("portfolio.concentration");
  });

  it("does not divide by zero on an empty portfolio", () => {
    const i = signalInputFixture();
    i.portfolio.liquidPortfolio = 0;
    i.portfolio.largestPosition = { label: "TSLA", value: 10 };
    expect(() => portfolioSignals(i)).not.toThrow();
    expect(ids(i)).not.toContain("portfolio.concentration");
  });
});
