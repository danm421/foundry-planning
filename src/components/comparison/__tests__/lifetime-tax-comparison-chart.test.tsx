// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LifetimeTaxComparisonChart } from "../lifetime-tax-comparison-chart";

vi.mock("react-chartjs-2", () => ({
  Bar: ({ data }: { data: { labels: string[]; datasets: Array<{ label: string; data: number[] }> } }) => (
    <pre data-testid="chart">{JSON.stringify(data)}</pre>
  ),
}));

const zero = {
  regularFederalIncomeTax: 0, capitalGainsTax: 0, amtAdditional: 0,
  niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
};

describe("LifetimeTaxComparisonChart", () => {
  it("renders only buckets with non-zero values across both plans", () => {
    const { getByTestId } = render(
      <LifetimeTaxComparisonChart
        plan1Buckets={{ ...zero, regularFederalIncomeTax: 100, niit: 0, fica: 50 }}
        plan2Buckets={{ ...zero, regularFederalIncomeTax: 80, niit: 10, fica: 50 }}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.labels).toEqual(["Federal income tax", "NIIT", "FICA"]);
    expect(data.datasets[0].label).toBe("Base");
    expect(data.datasets[0].data).toEqual([100, 0, 50]);
    expect(data.datasets[1].data).toEqual([80, 10, 50]);
  });
});
