import { describe, it, expect } from "vitest";
import { riskSignals } from "../risk";
import { signalInputFixture } from "./fixture";

const ids = (input: Parameters<typeof riskSignals>[0]) =>
  riskSignals(input).map((s) => s.id);

describe("riskSignals", () => {
  it("fires nothing for a clean household", () => {
    expect(riskSignals(signalInputFixture())).toEqual([]);
  });

  it("fires no_profile when there is no tolerance score", () => {
    const input = signalInputFixture();
    input.risk.toleranceScore = null;
    input.risk.toleranceConfirmedAt = null;
    expect(ids(input)).toContain("risk.no_profile");
  });

  it("does not also fire review_due when there is no profile at all", () => {
    const input = signalInputFixture();
    input.risk.toleranceScore = null;
    input.risk.toleranceConfirmedAt = null;
    expect(ids(input)).not.toContain("risk.review_due");
  });

  it("fires review_due once the tolerance is over 12 months old", () => {
    const input = signalInputFixture();
    input.risk.toleranceConfirmedAt = new Date("2025-01-01T00:00:00Z");
    expect(ids(input)).toContain("risk.review_due");
  });

  it("does not fire review_due one day before the boundary", () => {
    const input = signalInputFixture();
    // now is 2026-08-08; 12 months back is 2025-08-08. One day later is inside.
    input.risk.toleranceConfirmedAt = new Date("2025-08-09T00:00:00Z");
    expect(ids(input)).not.toContain("risk.review_due");
  });

  it("fires portfolio_off_target and names the target portfolio", () => {
    const input = signalInputFixture();
    input.risk.mismatch = {
      kind: "mismatch", level: "moderate", targetName: "Balanced (60/40)",
      applyToPortfolioId: "22222222-2222-2222-2222-222222222222", buckets: [],
    };
    const s = riskSignals(input).find((x) => x.id === "risk.portfolio_off_target");
    expect(s).toBeDefined();
    expect(s!.detail).toContain("Balanced (60/40)");
    expect(s!.href).toBe(`/risk/${input.clientId}`);
  });

  it("fires tolerance_below_required as critical when goals outrun willingness", () => {
    const input = signalInputFixture();
    input.risk.toleranceScore = 40;
    input.risk.alignment = { ...input.risk.alignment, requiredPct: 70 };
    const s = riskSignals(input).find((x) => x.id === "risk.tolerance_below_required");
    expect(s?.severity).toBe("critical");
  });

  it("respects the 5-point tolerance band on tolerance_below_required", () => {
    const input = signalInputFixture();
    input.risk.toleranceScore = 60;
    input.risk.alignment = { ...input.risk.alignment, requiredPct: 65 };
    expect(ids(input)).not.toContain("risk.tolerance_below_required");
  });

  it("fires capacity_binding when capacity is the binding constraint", () => {
    const input = signalInputFixture();
    input.risk.bindingConstraint = "capacity";
    expect(ids(input)).toContain("risk.capacity_binding");
  });

  it("fires allocation_off for an over-risked verdict", () => {
    const input = signalInputFixture();
    input.risk.alignment = { ...input.risk.alignment, verdict: "over_risked" };
    expect(ids(input)).toContain("risk.allocation_off");
  });
});
