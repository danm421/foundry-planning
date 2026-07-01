// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientData, ProjectionYear } from "@/engine/types";

// Mock react-chartjs-2/chart.js so jsdom never has to draw a canvas.
vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart-bar" />,
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  CategoryScale: {},
  LinearScale: {},
  BarElement: {},
  Tooltip: {},
  Legend: {},
}));

// Isolate the toggle-gating logic under test from the estate-comparison
// builder's own data plumbing (covered by Task 5's tests) — return a fixed,
// minimal comparison regardless of args.
vi.mock("@/lib/estate/estate-comparison", () => ({
  buildEstateComparison: () => ({
    year: 2030,
    base: { toHeirs: 0, taxesAndExpenses: 0, toCharity: 0 },
    proposed: { toHeirs: 0, taxesAndExpenses: 0, toCharity: 0 },
    deltas: { toHeirs: 0, taxesAndExpenses: 0, toCharity: 0 },
  }),
}));

import { EstateComparisonChart } from "../estate-comparison-chart";

const MAX_YEAR = 2040;

function projection(): ProjectionYear[] {
  const years: ProjectionYear[] = [];
  for (let y = 2026; y <= MAX_YEAR; y++) {
    years.push({
      year: y,
      hypotheticalEstateTax: { year: y, primaryFirst: {} },
    } as unknown as ProjectionYear);
  }
  return years;
}

const tree = {
  client: {
    firstName: "Pat",
    lastName: "Lee",
    dateOfBirth: "1960-01-01",
    spouseName: "Sam Lee",
    spouseDob: "1962-01-01",
  },
} as unknown as ClientData;

function renderChart(firstDeathYear: number | null) {
  return render(
    <EstateComparisonChart
      baseProjection={projection()}
      proposedProjection={projection()}
      baseTree={tree}
      proposedTree={tree}
      isMarried
      firstDeathYear={firstDeathYear}
    />,
  );
}

describe("EstateComparisonChart death-order toggle", () => {
  it("hides the toggle once the viewing year is at/after the first death", () => {
    // selectedYear initializes to maxYear (2040); firstDeathYear <= maxYear
    // means selectedYear >= firstDeathYear from the start.
    renderChart(2035);
    expect(
      screen.queryByRole("button", { name: "Client first" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Spouse first" }),
    ).not.toBeInTheDocument();
  });

  it("shows the toggle when the viewing year is before the first death", () => {
    // firstDeathYear > maxYear means selectedYear (=maxYear) < firstDeathYear.
    renderChart(2045);
    expect(
      screen.getByRole("button", { name: "Client first" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Spouse first" }),
    ).toBeInTheDocument();
  });

  it("shows the toggle when firstDeathYear is unknown (null)", () => {
    renderChart(null);
    expect(
      screen.getByRole("button", { name: "Client first" }),
    ).toBeInTheDocument();
  });
});
