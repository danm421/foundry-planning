// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ViewModeFrame } from "../view-mode";

describe("ViewModeFrame", () => {
  const chart = <div>CHART</div>;
  const table = <div>TABLE</div>;

  it("renders only the chart in 'chart' mode", () => {
    render(<ViewModeFrame mode="chart" chart={chart} table={table} />);
    expect(screen.getByText("CHART")).toBeInTheDocument();
    expect(screen.queryByText("TABLE")).not.toBeInTheDocument();
  });

  it("renders only the table in 'table' mode", () => {
    render(<ViewModeFrame mode="table" chart={chart} table={table} />);
    expect(screen.queryByText("CHART")).not.toBeInTheDocument();
    expect(screen.getByText("TABLE")).toBeInTheDocument();
  });

  it("renders both stacked in 'chart+table' mode", () => {
    render(<ViewModeFrame mode="chart+table" chart={chart} table={table} />);
    expect(screen.getByText("CHART")).toBeInTheDocument();
    expect(screen.getByText("TABLE")).toBeInTheDocument();
  });
});
