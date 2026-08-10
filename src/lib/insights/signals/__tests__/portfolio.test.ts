import { describe, it, expect } from "vitest";
import { portfolioSignals } from "../portfolio";
import { signalInputFixture } from "./fixture";

const ids = (i: Parameters<typeof portfolioSignals>[0]) =>
  portfolioSignals(i).map((s) => s.id);

/**
 * Every base here is `allocatedTotal` (the allocation rollup's own dollar total)
 * or the position's `holdingsTotal`. `liquidPortfolio` — a sum of `accounts.value`
 * over a different set of accounts entirely — is no longer reachable from this
 * input at all, so reaching for the wrong base is now a compile error rather
 * than a wrong figure on an advisor's screen.
 */
describe("portfolioSignals", () => {
  it("fires nothing for a clean portfolio", () => {
    expect(portfolioSignals(signalInputFixture())).toEqual([]);
  });

  it("prices cash drag against the allocated base, not the liquid portfolio", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.20;          // 10 points above the threshold
    i.portfolio.allocatedTotal = 1_000_000;
    i.portfolio.cashReturn = 0.01;
    i.portfolio.equityReturn = 0.06;
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.cash_drag");
    // excess = (0.20 - 0.10) * 1_000_000 = 100_000, not 200_000
    expect(s!.numbers.excessDollars).toBe(100_000);
    expect(s!.detail).toContain("1,000,000 dollars held in accounts with an asset mix");
  });

  it("measures concentration against reported holdings, not the liquid portfolio", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 150_000, holdingsTotal: 1_000_000 };
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    // 15% of the position's own holdings total, not of any account-value sum.
    expect(s!.numbers.share).toBeCloseTo(0.15, 6);
    expect(s!.title).toContain("15% of reported holdings");
  });

  it("fires cash_drag above 10% cash", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.25;
    expect(ids(i)).toContain("portfolio.cash_drag");
  });

  it("prices cash drag at the CMA spread on the EXCESS cash only", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.20;         // 10 points above the threshold
    i.portfolio.allocatedTotal = 1_000_000;
    i.portfolio.cashReturn = 0.01;
    i.portfolio.equityReturn = 0.06;
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.cash_drag");
    // excess = (0.20 - 0.10) * 1_000_000 = 100_000; spread = 0.05 → 5_000
    expect(s!.estimatedImpact).toBeCloseTo(5_000, 6);
  });

  it("floors the impact at zero when the CMA gives cash and equity the same return", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.25;
    i.portfolio.allocatedTotal = 1_000_000;
    i.portfolio.cashReturn = 0.04;
    i.portfolio.equityReturn = 0.04; // flat CMA — no spread to price
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.cash_drag");
    expect(s).toBeDefined();
    expect(s!.estimatedImpact).toBe(0);
  });

  it("does not go negative when the CMA is inverted (cash beats equity)", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.25;
    i.portfolio.allocatedTotal = 1_000_000;
    i.portfolio.cashReturn = 0.06;
    i.portfolio.equityReturn = 0.01; // inverted CMA
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.cash_drag");
    expect(s).toBeDefined();
    expect(s!.estimatedImpact).toBe(0);
  });

  it("does not fire cash_drag exactly at the threshold", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.10;
    expect(ids(i)).not.toContain("portfolio.cash_drag");
  });

  it("does not fire cash_drag when nothing carries an asset mix, whatever the cash share", () => {
    const i = signalInputFixture();
    i.portfolio.cashPct = 0.5;
    i.portfolio.allocatedTotal = 0;
    expect(ids(i)).not.toContain("portfolio.cash_drag");
  });

  it("fires concentration as watch above 10% of reported holdings", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 150_000, holdingsTotal: 1_000_000 };
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("watch");
    expect(s!.detail).toContain("TSLA");
  });

  it("does not fire concentration exactly at the watch threshold", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 100_000, holdingsTotal: 1_000_000 }; // exactly 10%
    expect(ids(i)).not.toContain("portfolio.concentration");
  });

  it("escalates concentration to critical above 20%", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 300_000, holdingsTotal: 1_000_000 };
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("critical");
  });

  it("stays watch, not critical, exactly at the critical threshold", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 200_000, holdingsTotal: 1_000_000 }; // exactly 20%
    const s = portfolioSignals(i).find((x) => x.id === "portfolio.concentration");
    expect(s?.severity).toBe("watch");
  });

  it("does not fire concentration when no holdings are known", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = null;
    expect(ids(i)).not.toContain("portfolio.concentration");
  });

  it("does not divide by zero when the holdings total is zero", () => {
    const i = signalInputFixture();
    i.portfolio.largestPosition = { label: "TSLA", value: 10, holdingsTotal: 0 };
    expect(() => portfolioSignals(i)).not.toThrow();
    expect(ids(i)).not.toContain("portfolio.concentration");
  });
});
