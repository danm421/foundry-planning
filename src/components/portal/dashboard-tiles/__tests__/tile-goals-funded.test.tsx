// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TileGoalsFunded } from "@/components/portal/dashboard-tiles/tile-goals-funded";
import type { PortalGoalFunding } from "@/lib/portal/contracts";

const RETIREMENT: PortalGoalFunding = {
  id: "retirement",
  kind: "retirement",
  label: "Retirement",
  forName: null,
  startYear: 2045,
  endYear: 2075,
  cost: 3_000_000,
  funded: 2_400_000,
  pctFunded: 0.8,
};

describe("TileGoalsFunded", () => {
  it("shows the percent, the span and the gap", () => {
    render(<TileGoalsFunded goals={[RETIREMENT]} projected />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("2045–2075")).toBeInTheDocument();
    expect(screen.getByText("$600,000 short of $3,000,000")).toBeInTheDocument();
  });

  it("reads as fully funded with no gap at 100%", () => {
    render(
      <TileGoalsFunded
        goals={[{ ...RETIREMENT, funded: 3_000_000, pctFunded: 1 }]}
        projected
      />,
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("$3,000,000 funded")).toBeInTheDocument();
    expect(screen.queryByText(/short of/)).not.toBeInTheDocument();
  });

  /**
   * `funded` is a float sum against a float cost, so a goal the plan funds in
   * full comes back nanodollars short of it. The numbers here are a live plan's
   * — a $14,855,141 retirement whose gap measured 7.45e-9 — and the caption read
   * "$0 short of $14,855,141" under a full green bar.
   */
  it("reads as funded when the only gap is float residue that prints as $0", () => {
    const cost = 14_855_141;
    render(
      <TileGoalsFunded
        goals={[{ ...RETIREMENT, cost, funded: cost - 7.451e-9, pctFunded: 1 }]}
        projected
      />,
    );
    expect(screen.getByText("$14,855,141 funded")).toBeInTheDocument();
    expect(screen.queryByText("$0 short of $14,855,141")).not.toBeInTheDocument();
    expect(screen.queryByText(/short of/)).not.toBeInTheDocument();
  });

  // The guard must not swallow a gap the reader CAN see: a dollar still reads
  // as a dollar short.
  it("still reports a gap that prints as a real figure", () => {
    render(
      <TileGoalsFunded
        goals={[{ ...RETIREMENT, cost: 3_000_000, funded: 2_999_999, pctFunded: 1 }]}
        projected
      />,
    );
    expect(screen.getByText("$1 short of $3,000,000")).toBeInTheDocument();
  });

  // An empty list means two different things, and saying the wrong one tells a
  // household with a real plan that it was never projected.
  it("distinguishes an unprojected plan from a plan with no goals", () => {
    const { unmount } = render(<TileGoalsFunded goals={[]} projected={false} />);
    expect(screen.getByText(/hasn't been projected yet/)).toBeInTheDocument();
    unmount();

    render(<TileGoalsFunded goals={[]} projected />);
    expect(screen.getByText(/No goals on your plan yet/)).toBeInTheDocument();
    expect(screen.queryByText(/hasn't been projected yet/)).not.toBeInTheDocument();
  });

  it("names the beneficiary on a goal that has one", () => {
    render(
      <TileGoalsFunded
        goals={[
          {
            id: "edu1", kind: "education", label: "College", forName: "Ava",
            startYear: 2036, endYear: 2039, cost: 200_000, funded: 200_000, pctFunded: 1,
          },
        ]}
        projected
      />,
    );
    expect(screen.getByText(/for Ava/)).toBeInTheDocument();
  });
});
