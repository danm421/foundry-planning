// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskAlignmentScale } from "../risk-alignment-scale";
import type { RiskAlignment } from "@/lib/insights/risk-capacity";

const risk: RiskAlignment = {
  currentPct: 78,
  requiredPct: 45,
  capacityPct: 60,
  capacityScore: 60,
  verdict: "over_risked",
};

describe("RiskAlignmentScale", () => {
  it("plots the recorded tolerance as a fourth marker", () => {
    render(<RiskAlignmentScale risk={risk} tolerancePct={33} />);
    expect(screen.getByText("Tolerance")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  /**
   * The null case is the point of the optional prop. A household with no RTQ
   * must show THREE markers — a fourth pinned at 0% would read as "this client
   * will accept no risk at all", which is the opposite of "we never asked".
   */
  it("omits the tolerance marker entirely when no profile is on file", () => {
    render(<RiskAlignmentScale risk={risk} tolerancePct={null} />);
    expect(screen.queryByText("Tolerance")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    // The other three are unaffected.
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("Capacity")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("omits the tolerance marker when the prop is not supplied at all", () => {
    render(<RiskAlignmentScale risk={risk} />);
    expect(screen.queryByText("Tolerance")).not.toBeInTheDocument();
  });
});
