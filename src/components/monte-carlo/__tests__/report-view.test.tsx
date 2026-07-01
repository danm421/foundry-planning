// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/chart-colors", () => ({ useThemeName: () => "dark" }));
vi.mock("../fan-chart", () => ({
  FanChart: ({ variant, onPromote }: { variant: string; onPromote?: () => void }) =>
    <button data-testid={`fan-${variant}`} onClick={onPromote}>fan</button>,
}));
vi.mock("../terminal-histogram", () => ({
  TerminalHistogram: ({ variant, onPromote }: { variant: string; onPromote?: () => void }) =>
    <button data-testid={`hist-${variant}`} onClick={onPromote}>hist</button>,
}));
vi.mock("../longevity-chart", () => ({
  LongevityChart: ({ variant, onPromote }: { variant: string; onPromote?: () => void }) =>
    <button data-testid={`long-${variant}`} onClick={onPromote}>long</button>,
}));
vi.mock("../kpi-band", () => ({ KpiBand: () => <div data-testid="kpi" /> }));
vi.mock("../findings-card", () => ({ FindingsCard: () => <div data-testid="findings" /> }));
vi.mock("../report-header", () => ({ ReportHeader: () => <div data-testid="header" /> }));
vi.mock("../yearly-breakdown", () => ({ YearlyBreakdown: () => <div data-testid="yearly" /> }));

import { MonteCarloReportView } from "../report-view";

const summary = { trialsRun: 1000, byYear: [{ age: { client: 65 } }] } as never;
const raw = { byYearLiquidAssetsPerTrial: [[100], [50]] } as never;
const meta = {
  requiredMinimumAssetLevel: 0, startingLiquidBalance: 0, planStartYear: 2026,
  clientBirthYear: 1961, clientDisplayName: "Ada Byron", annualIncomeAtStart: 0,
  retirementAge: 65, spouseRetirementAge: undefined,
} as never;

function renderView(extra = {}) {
  return render(
    <MonteCarloReportView summary={summary} raw={raw} deterministic={[1, 2]} meta={meta} {...extra} />,
  );
}

describe("MonteCarloReportView", () => {
  it("shows the fan chart as main and the others as compact by default", () => {
    renderView();
    expect(screen.getByTestId("fan-main")).toBeInTheDocument();
    expect(screen.getByTestId("hist-compact")).toBeInTheDocument();
    expect(screen.getByTestId("long-compact")).toBeInTheDocument();
  });

  it("promotes a compact chart to main on click", async () => {
    renderView();
    await userEvent.click(screen.getByTestId("hist-compact"));
    expect(screen.getByTestId("hist-main")).toBeInTheDocument();
    expect(screen.getByTestId("fan-compact")).toBeInTheDocument();
  });

  it("stacks the sub-charts below the main chart and drops the Key Findings card in stacked layout", () => {
    renderView({ layout: "stacked" });
    expect(screen.getByTestId("fan-main")).toBeInTheDocument();
    expect(screen.getByTestId("hist-compact")).toBeInTheDocument();
    expect(screen.getByTestId("long-compact")).toBeInTheDocument();
    // Findings fold into the KPI band, so the standalone findings card is gone.
    expect(screen.queryByTestId("findings")).not.toBeInTheDocument();
  });

  it("hides the header when showHeader is false", () => {
    renderView({ showHeader: false });
    expect(screen.queryByTestId("header")).not.toBeInTheDocument();
  });

  it("renders no reseed button when onReseed is omitted", () => {
    renderView();
    expect(screen.queryByRole("button", { name: /generate new seed/i })).not.toBeInTheDocument();
  });
});
