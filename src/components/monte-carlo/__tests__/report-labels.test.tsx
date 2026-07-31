// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => "dark",
  chartChrome: () => ({
    tooltipBg: "#000",
    tooltipTitle: "#fff",
    tooltipBody: "#fff",
    grid: "#333",
    tick: "#999",
  }),
}));
vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="bar" />,
}));

import { KpiBand } from "../kpi-band";
import { TerminalHistogram } from "../terminal-histogram";

const summary = {
  successRate: 0.84,
  failureRate: 0.16,
  trialsRun: 1000,
  ending: { p50: 1_000_000 },
} as never;

describe("Monte Carlo report labels", () => {
  it("labels the plan-level metric Shortfall Risk with a fell-short footnote", () => {
    render(<KpiBand summary={summary} startAge={65} annualIncome={200_000} includeFailureKpi />);
    expect(screen.getByText("Shortfall Risk")).toBeInTheDocument();
    expect(screen.getByText("160 of 1,000 trials fell short")).toBeInTheDocument();
  });

  it("labels the histogram's ending-only count separately from Shortfall Risk", () => {
    render(
      <TerminalHistogram
        endingValues={[0, 0, 500_000, 2_000_000]}
        trialsRun={4}
        requiredMinimumAssetLevel={100_000}
        startingLiquidBalance={500_000}
        variant="main"
      />,
    );
    expect(screen.getByText("Ended below minimum")).toBeInTheDocument();
    // Guard: the histogram's number is ending-only and differs from
    // summary.failureRate. Sharing a label would show two percentages
    // under one name on the same screen.
    expect(screen.queryByText("Shortfall Risk")).not.toBeInTheDocument();
  });

  it("no longer uses success/failure wording on either card", () => {
    render(<KpiBand summary={summary} startAge={65} annualIncome={200_000} includeFailureKpi />);
    expect(screen.queryByText(/probability of failure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ran out of money/i)).not.toBeInTheDocument();
  });

  it("gives the confidence gauge a visible caption and a matching aria-label", () => {
    render(<KpiBand summary={summary} startAge={65} annualIncome={200_000} />);
    expect(screen.getByText("Plan Confidence")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Plan confidence 84 percent" })).toBeInTheDocument();
  });
});
