// src/components/risk/__tests__/capacity-breakdown.test.tsx
// @vitest-environment jsdom
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";

import { CapacityBreakdown } from "@/components/risk/capacity-breakdown";
import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";

// Roughly a real household: decades before retirement, a partial buffer, heavy
// withdrawals, and a thin income floor.
const factors: CapacityFactors = {
  runway: 0.5,
  incomeFloor: 0.099,
  retirementHorizon: 0.15,
  withdrawal: 0,
  buffer: 0.111,
};

describe("CapacityBreakdown", () => {
  it("renders each factor against its own weight ceiling", () => {
    render(<CapacityBreakdown factors={factors} />);
    expect(screen.getByText("Years to retirement")).toBeTruthy();
    // A maxed factor reads as a full bar whatever weight it carries: "50 / 50".
    expect(screen.getByText(`50 / ${Math.round(CAPACITY_WEIGHTS.runway * 100)}`)).toBeTruthy();
    // 0.099 against a 0.48 ceiling -> "10 / 48"
    expect(screen.getByText(`10 / ${Math.round(CAPACITY_WEIGHTS.incomeFloor * 100)}`)).toBeTruthy();
  });

  it("shows ceilings that total 143, the headroom over the capped score", () => {
    render(<CapacityBreakdown factors={factors} />);
    const total = Object.values(CAPACITY_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(Math.round(total * 100)).toBe(143);
    // Each ceiling is rendered, so the bars visibly total more than a maxed score.
    for (const w of Object.values(CAPACITY_WEIGHTS)) {
      expect(screen.getAllByText(new RegExp(`/ ${Math.round(w * 100)}$`)).length).toBeGreaterThan(0);
    }
  });

  it("gives every factor a help tooltip, in bar order", () => {
    render(<CapacityBreakdown factors={factors} />);
    const tips = screen.getAllByRole("tooltip").map((el) => el.textContent ?? "");
    expect(tips).toHaveLength(5);
    // Order matters: the copy must sit on the bar it describes, not its neighbour.
    expect(tips[0]).toContain("until the portfolio has to start paying out");
    expect(tips[1]).toContain("Social Security and pensions");
    expect(tips[2]).toContain("Years from retirement to the end of the plan");
    expect(tips[3]).toContain("spending not covered by income");
    expect(tips[4]).toContain("lowest point the portfolio reaches");
  });

  it("leads with the two factors that actually carry the score", () => {
    render(<CapacityBreakdown factors={factors} />);
    const labels = ["Years to retirement", "Guaranteed income"];
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
    // Both heavyweights outrank every supporting factor's ceiling.
    const supporting = Math.max(
      CAPACITY_WEIGHTS.retirementHorizon,
      CAPACITY_WEIGHTS.withdrawal,
      CAPACITY_WEIGHTS.buffer,
    );
    expect(CAPACITY_WEIGHTS.runway).toBeGreaterThan(supporting);
    expect(CAPACITY_WEIGHTS.incomeFloor).toBeGreaterThan(supporting);
  });

  it("explains the guaranteed-income floor in terms an advisor can read aloud", () => {
    render(<CapacityBreakdown factors={factors} />);
    const floor = screen.getAllByRole("tooltip")[1].textContent ?? "";
    // The fix this copy documents: the floor spans the years benefits are paid,
    // not the retirement year alone.
    expect(floor).toContain("averaged over the years those benefits are actually paid");
    // And that a full floor stands on its own, whatever the client's age.
    expect(floor).toContain("no matter its age");
  });

  it("exposes the help as a focusable control, not hover-only", () => {
    render(<CapacityBreakdown factors={factors} />);
    const badges = screen.getAllByRole("button", { name: "Show help" });
    expect(badges).toHaveLength(5);
    badges[4].focus();
    expect(document.activeElement).toBe(badges[4]);
  });
});
