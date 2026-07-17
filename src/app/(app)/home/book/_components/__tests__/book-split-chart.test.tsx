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
});
