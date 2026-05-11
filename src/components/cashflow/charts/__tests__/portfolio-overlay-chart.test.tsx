// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ProjectionYear } from "@/engine/types";
import { PortfolioOverlayChart } from "../portfolio-overlay-chart";

vi.mock("react-chartjs-2", () => ({
  Line: vi.fn(() => null),
}));
import { Line } from "react-chartjs-2";

function yrs(values: number[]): ProjectionYear[] {
  return values.map(
    (v, i) =>
      ({ year: 2026 + i, portfolioAssets: { total: v } }) as unknown as ProjectionYear,
  );
}

describe("PortfolioOverlayChart (N-series)", () => {
  it("renders N datasets from plans[]", () => {
    render(
      <PortfolioOverlayChart
        plans={[
          { label: "Base", years: yrs([100, 110, 120]) },
          { label: "B", years: yrs([100, 130, 160]) },
          { label: "C", years: yrs([100, 90, 80]) },
        ]}
      />,
    );
    const props = vi.mocked(Line).mock.calls.at(-1)![0] as {
      data: { datasets: unknown[] };
    };
    expect(props.data.datasets).toHaveLength(3);
  });

  it("baseline dataset uses index-0 color + dotted dash", () => {
    render(
      <PortfolioOverlayChart
        plans={[
          { label: "Base", years: yrs([100]) },
          { label: "B", years: yrs([100]) },
        ]}
      />,
    );
    const props = vi.mocked(Line).mock.calls.at(-1)![0] as {
      data: {
        datasets: { label: string; borderColor: string; borderDash: number[] }[];
      };
    };
    expect(props.data.datasets[0].borderColor).toBe("#cbd5e1");
    expect(props.data.datasets[0].borderDash).toEqual([2, 3]);
    expect(props.data.datasets[1].borderColor).toBe("#34d399");
    expect(props.data.datasets[1].borderDash).toEqual([]);
  });

  it("renders Line, not stacked area (no fill)", () => {
    render(
      <PortfolioOverlayChart
        plans={[
          { label: "Base", years: yrs([100]) },
          { label: "B", years: yrs([100]) },
        ]}
      />,
    );
    const props = vi.mocked(Line).mock.calls.at(-1)![0] as {
      data: { datasets: { fill: boolean | undefined }[] };
    };
    expect(
      props.data.datasets.every((d) => d.fill === false || d.fill === undefined),
    ).toBe(true);
  });
});
