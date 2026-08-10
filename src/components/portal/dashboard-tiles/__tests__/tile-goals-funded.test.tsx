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
