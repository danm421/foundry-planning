// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverLifetimeTaxKpi } from "../solver-lifetime-tax-kpi";

describe("solver summary KPIs", () => {
  it("renders lifetime taxes as currency", () => {
    render(<SolverLifetimeTaxKpi value={1234567} />);
    expect(screen.getByText(/\$1,234,567|\$1\.23M/)).toBeInTheDocument();
  });
});
