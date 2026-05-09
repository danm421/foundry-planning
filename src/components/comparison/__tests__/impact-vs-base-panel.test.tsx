// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ImpactVsBasePanel } from "../impact-vs-base-panel";

vi.mock("react-chartjs-2", () => ({
  Bar: ({
    data,
  }: {
    data: { labels: string[]; datasets: Array<{ label: string; data: number[] }> };
  }) => <pre data-testid="chart">{JSON.stringify(data)}</pre>,
}));

describe("ImpactVsBasePanel", () => {
  it("renders deltas with correct sign and includes year and labels", () => {
    const { getByText, getByTestId } = render(
      <ImpactVsBasePanel
        year={2055}
        plan1Label="Base"
        plan2Label="Proposed"
        plan1={{ totalToHeirs: 164_000_000, taxesAndExpenses: 53_000_000, totalToCharities: 0 }}
        plan2={{ totalToHeirs: 187_000_000, taxesAndExpenses: 34_000_000, totalToCharities: 0 }}
      />,
    );
    expect(getByText("Impact vs Base (2055)")).toBeTruthy();
    expect(getByText("+$23,000,000")).toBeTruthy();
    expect(getByText("-$19,000,000")).toBeTruthy();
    expect(getByText("+$0")).toBeTruthy();

    const data = JSON.parse(getByTestId("chart").textContent ?? "{}");
    expect(data.labels).toEqual(["Total to Heirs", "Taxes & Expenses", "Total to Charities"]);
    expect(data.datasets[0].label).toBe("Base");
    expect(data.datasets[0].data).toEqual([164_000_000, 53_000_000, 0]);
    expect(data.datasets[1].label).toBe("Proposed");
    expect(data.datasets[1].data).toEqual([187_000_000, 34_000_000, 0]);
  });

  it("colors deltas: heirs/charities up = green, taxes down = green", () => {
    const { container } = render(
      <ImpactVsBasePanel
        year={2055}
        plan1Label="Base"
        plan2Label="Proposed"
        plan1={{ totalToHeirs: 100, taxesAndExpenses: 100, totalToCharities: 100 }}
        plan2={{ totalToHeirs: 200, taxesAndExpenses: 50, totalToCharities: 200 }}
      />,
    );
    const greens = container.querySelectorAll(".text-emerald-400");
    expect(greens.length).toBe(3);
  });

  it("colors deltas: heirs/charities down = red, taxes up = red", () => {
    const { container } = render(
      <ImpactVsBasePanel
        year={2055}
        plan1Label="Base"
        plan2Label="Proposed"
        plan1={{ totalToHeirs: 200, taxesAndExpenses: 50, totalToCharities: 200 }}
        plan2={{ totalToHeirs: 100, taxesAndExpenses: 100, totalToCharities: 100 }}
      />,
    );
    const reds = container.querySelectorAll(".text-rose-400");
    expect(reds.length).toBe(3);
  });
});
