import { describe, it, expect } from "vitest";
import { buildSignals } from "../index";
import { signalInputFixture } from "./fixture";

describe("buildSignals", () => {
  it("returns an empty list for a household with nothing to say", () => {
    const i = signalInputFixture();
    i.tax = { observations: [], taxYear: 2025 };
    expect(buildSignals(i)).toEqual([]);
  });

  it("collects across every domain and orders by severity", () => {
    const i = signalInputFixture();
    i.plan.fundingScore = 0.5;              // plan.funding_shortfall  → critical
    i.portfolio.cashPct = 0.3;              // portfolio.cash_drag     → opportunity
    i.relationship.overdueTaskCount = 2;    // relationship.overdue    → watch
    i.tax = { observations: [], taxYear: null }; // tax.no_return      → info

    const out = buildSignals(i);
    expect(out.map((s) => s.severity)).toEqual([
      "critical", "opportunity", "watch", "info",
    ]);
    expect(new Set(out.map((s) => s.domain))).toEqual(
      new Set(["plan", "portfolio", "relationship", "tax"]),
    );
  });

  it("emits globally unique signal ids", () => {
    const i = signalInputFixture();
    i.risk.toleranceScore = null;
    i.plan.fundingScore = 0.5;
    i.portfolio.cashPct = 0.4;
    i.relationship.overdueTaskCount = 1;
    const ids = buildSignals(i).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prefixes every id with its own domain", () => {
    const i = signalInputFixture();
    i.risk.toleranceScore = null;
    i.plan.fundingScore = 0.5;
    for (const s of buildSignals(i)) {
      expect(s.id.startsWith(`${s.domain}.`)).toBe(true);
    }
  });
});
