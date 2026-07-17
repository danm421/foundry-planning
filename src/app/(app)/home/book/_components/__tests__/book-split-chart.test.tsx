// src/app/(app)/home/book/_components/__tests__/book-split-chart.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// react-chartjs-2 needs canvas; stub it and assert the datasets we pass.
const seen: { data?: unknown } = {};
vi.mock("react-chartjs-2", () => ({
  Chart: (props: { data: unknown }) => {
    seen.data = props.data;
    return <div data-testid="chart" />;
  },
  Bar: (props: { data: unknown }) => {
    seen.data = props.data;
    return <div data-testid="chart" />;
  },
}));

import { BookSplitChart } from "../book-split-chart";
import type { BookBreakdown } from "@/lib/home/book-breakdown";
// jsdom leaves document.documentElement.dataset.theme unset, so useThemeName()
// resolves to "dark" and the component paints from the `data` palette (not
// `dataLight`). Assert against the real brand colors instead of hardcoded hex.
import { data as brandData } from "@/brand";

const DATA: BookBreakdown = {
  households: [
    { householdId: "h2", householdName: "Baxter", bookValue: 400000, heldAway: 0, total: 400000, accounts: [] },
    { householdId: "h1", householdName: "Anderson", bookValue: 200000, heldAway: 50000, total: 250000, accounts: [] },
  ],
  totals: { bookValue: 600000, heldAway: 50000, total: 650000, heldAwayAccounts: 1, householdCount: 2 },
  concentration: { top5BookSharePct: 100, largestHeldAway: { householdName: "Anderson", value: 50000 }, heldAwayHouseholdCount: 1 },
};

describe("BookSplitChart", () => {
  it("renders without touching a real canvas", () => {
    const { getByTestId } = render(<BookSplitChart data={DATA} />);
    expect(getByTestId("chart")).toBeInTheDocument();
    expect(seen.data).toBeDefined();
  });

  it("passes two datasets ranked top-N by total, blue=book / orange=held-away", () => {
    render(<BookSplitChart data={DATA} />);
    const chartData = seen.data as {
      labels: string[];
      datasets: { label: string; backgroundColor: string; data: number[] }[];
    };

    // Top-N by total desc: Baxter (400000) before Anderson (250000).
    expect(chartData.labels).toEqual(["Baxter", "Anderson"]);

    expect(chartData.datasets).toHaveLength(2);

    expect(chartData.datasets[0].label).toBe("Book value");
    expect(chartData.datasets[0].backgroundColor).toBe(brandData.blue);
    expect(chartData.datasets[0].data).toEqual([400000, 200000]);

    expect(chartData.datasets[1].label).toBe("Held away");
    expect(chartData.datasets[1].backgroundColor).toBe(brandData.orange);
    expect(chartData.datasets[1].data).toEqual([0, 50000]);
  });
});
