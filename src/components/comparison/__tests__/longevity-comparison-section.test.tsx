// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LongevityComparisonSection } from "../longevity-comparison-section";

vi.mock("@/components/monte-carlo/longevity-chart", () => ({
  LongevityChart: () => <div data-testid="longevity-chart" />,
}));

function matrix(rates: number[][]): number[][] {
  return rates;
}

describe("LongevityComparisonSection (N rails)", () => {
  it("renders one rail per plan at N=4", () => {
    render(
      <LongevityComparisonSection
        plans={[
          { label: "Base", matrix: matrix([[1, 1, 0], [1, 1, 0]]) },
          { label: "A",    matrix: matrix([[1, 1, 0], [1, 1, 0]]) },
          { label: "B",    matrix: matrix([[1, 1, 1], [1, 1, 1]]) },
          { label: "C",    matrix: matrix([[1, 0, 0], [1, 0, 0]]) },
        ]}
        threshold={0.5}
        planStartYear={2026}
      />,
    );
    expect(screen.getAllByTestId("longevity-chart")).toHaveLength(4);
  });
});
