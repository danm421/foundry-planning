// src/components/balance-sheet-report/__tests__/household-summary-panel.test.tsx
// @vitest-environment jsdom
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub the Pie so jsdom never touches a <canvas>; surface the slice labels so we
// can assert what got fed to the chart.
vi.mock("react-chartjs-2", () => ({
  Pie: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="pie">{data.labels.join(",")}</div>
  ),
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  ArcElement: {},
  Tooltip: {},
  Legend: {},
}));

import HouseholdSummaryPanel from "@/components/balance-sheet-report/household-summary-panel";
import type { DonutSlice } from "@/components/balance-sheet-report/view-model";
import type { OwnerColumns } from "@/components/balance-sheet-report/household-columns";

const donut: DonutSlice[] = [
  { key: "taxable", label: "Taxable", value: 600_000, hex: "#2d61aa" },
  { key: "retirement", label: "Retirement", value: 300_000, hex: "#6c41a2" },
  { key: "cash", label: "Cash", value: 100_000, hex: "#1f8d5f" },
];
const totalAssets: OwnerColumns = { client: 700_000, spouse: 200_000, joint: 100_000, total: 1_000_000 };
const totalLiabilities: OwnerColumns = { client: 150_000, spouse: 50_000, joint: 0, total: 200_000 };
const netWorth: OwnerColumns = { client: 550_000, spouse: 150_000, joint: 100_000, total: 800_000 };

const baseProps = {
  donut,
  totalAssets,
  totalLiabilities,
  netWorth,
  hasSpouse: true,
  clientLabel: "Cooper",
  spouseLabel: "Sarah",
};

describe("HouseholdSummaryPanel", () => {
  it("feeds every non-empty slice to the pie", () => {
    render(<HouseholdSummaryPanel {...baseProps} />);
    expect(screen.getByTestId("pie").textContent).toBe("Taxable,Retirement,Cash");
  });

  it("renders a legend entry per slice with its share of assets", () => {
    render(<HouseholdSummaryPanel {...baseProps} />);
    // 600k / 300k / 100k of 1,000,000 → 60 / 30 / 10 %.
    expect(screen.getByText("Taxable")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("Retirement")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText("Cash")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
  });

  it("shows an empty state and no chart when there are no assets", () => {
    render(<HouseholdSummaryPanel {...baseProps} donut={[]} />);
    expect(screen.queryByTestId("pie")).toBeNull();
    expect(screen.getByText("No assets")).toBeTruthy();
  });

  it("renders the three summary rows with owner columns", () => {
    render(<HouseholdSummaryPanel {...baseProps} />);
    expect(screen.getByText("Total Assets")).toBeTruthy();
    expect(screen.getByText("Total Liabilities")).toBeTruthy();
    expect(screen.getByText("Net Worth")).toBeTruthy();
    // Owner column headers present for a couple household.
    expect(screen.getByText("Cooper")).toBeTruthy();
    expect(screen.getByText("Sarah")).toBeTruthy();
    expect(screen.getByText("Joint")).toBeTruthy();
    // Totals column.
    expect(screen.getByText("$1,000,000")).toBeTruthy();
    expect(screen.getByText("$800,000")).toBeTruthy();
    // Liabilities render as negative (red parens), matching the main table.
    expect(screen.getByText("($200,000)")).toBeTruthy();
  });

  it("collapses to Client + Total for a single-client household", () => {
    render(
      <HouseholdSummaryPanel
        {...baseProps}
        hasSpouse={false}
        spouseLabel={null}
      />,
    );
    expect(screen.getByText("Cooper")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    // No spouse identity and no Joint column when there's a single owner.
    expect(screen.queryByText("Sarah")).toBeNull();
    expect(screen.queryByText("Joint")).toBeNull();
  });
});
