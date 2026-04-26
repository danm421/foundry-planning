// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { NetDeltaSummary } from "../net-delta-summary";

describe("NetDeltaSummary", () => {
  it("renders + sign, short currency, and metric label for positive delta", () => {
    render(
      <NetDeltaSummary delta={1_500_000} metricLabel="end-of-plan portfolio" />,
    );
    expect(screen.getByText("NET DELTA")).toBeInTheDocument();
    expect(screen.getByTestId("net-delta-value")).toHaveTextContent("+$1.50M");
    expect(screen.getByText("end-of-plan portfolio")).toBeInTheDocument();
  });

  it("renders − sign and short currency for negative delta", () => {
    render(
      <NetDeltaSummary delta={-275_000} metricLabel="end-of-plan portfolio" />,
    );
    const value = screen.getByTestId("net-delta-value");
    expect(value).toHaveTextContent("−$275k");
    // Negative variant carries the red token
    expect(value.className).toContain("c87a7a");
  });

  it("hides the sparkline when fewer than 2 data points are provided", () => {
    const { rerender } = render(
      <NetDeltaSummary
        delta={100}
        metricLabel="end-of-plan portfolio"
        sparklineData={[]}
      />,
    );
    expect(screen.queryByTestId("net-delta-sparkline")).toBeNull();

    rerender(
      <NetDeltaSummary
        delta={100}
        metricLabel="end-of-plan portfolio"
        sparklineData={[42]}
      />,
    );
    expect(screen.queryByTestId("net-delta-sparkline")).toBeNull();
  });

  it("renders the sparkline when 2+ data points are provided", () => {
    render(
      <NetDeltaSummary
        delta={100}
        metricLabel="end-of-plan portfolio"
        sparklineData={[10, 20, 30, 25]}
      />,
    );
    const svg = screen.getByTestId("net-delta-sparkline");
    expect(svg).toBeInTheDocument();
    const polyline = svg.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // polyline must have at least one space-separated coordinate pair
    expect(polyline!.getAttribute("points")!.split(" ").length).toBe(4);
  });
});
