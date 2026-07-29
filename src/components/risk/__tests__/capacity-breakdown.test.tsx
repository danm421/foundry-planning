// src/components/risk/__tests__/capacity-breakdown.test.tsx
// @vitest-environment jsdom
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";

import { CapacityBreakdown } from "@/components/risk/capacity-breakdown";
import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";

// A mid-range set: every factor partly filled, none at a clamp boundary.
const factors: CapacityFactors = {
  horizon: 0.3,
  buffer: 0.222,
  withdrawal: 0.1,
  incomeFloor: 0.044,
};

describe("CapacityBreakdown", () => {
  it("renders each factor against its own weight ceiling", () => {
    render(<CapacityBreakdown factors={factors} />);
    expect(screen.getByText("Time horizon")).toBeTruthy();
    // 0.3 of a 0.3 ceiling -> "30 / 30"
    expect(screen.getByText(`30 / ${Math.round(CAPACITY_WEIGHTS.horizon * 100)}`)).toBeTruthy();
    // 0.044 of a 0.2 ceiling -> "4 / 20"
    expect(screen.getByText(`4 / ${Math.round(CAPACITY_WEIGHTS.incomeFloor * 100)}`)).toBeTruthy();
  });

  it("gives every factor a help tooltip, in bar order", () => {
    render(<CapacityBreakdown factors={factors} />);
    const tips = screen.getAllByRole("tooltip").map((el) => el.textContent ?? "");
    expect(tips).toHaveLength(4);
    // Order matters: the copy must sit on the bar it describes, not its neighbour.
    expect(tips[0]).toContain("Years from today to the end of the plan");
    expect(tips[1]).toContain("lowest point the portfolio reaches");
    expect(tips[2]).toContain("spending not covered by income");
    expect(tips[3]).toContain("Social Security and pensions");
  });

  it("explains the guaranteed-income floor in terms an advisor can read aloud", () => {
    render(<CapacityBreakdown factors={factors} />);
    const floor = screen.getAllByRole("tooltip")[3].textContent ?? "";
    // The fix this copy documents: the floor spans the years benefits are paid,
    // not the retirement year alone.
    expect(floor).toContain("averaged over the years those benefits are actually paid");
  });

  it("exposes the help as a focusable control, not hover-only", () => {
    render(<CapacityBreakdown factors={factors} />);
    const badges = screen.getAllByRole("button", { name: "Show help" });
    expect(badges).toHaveLength(4);
    badges[3].focus();
    expect(document.activeElement).toBe(badges[3]);
  });
});
