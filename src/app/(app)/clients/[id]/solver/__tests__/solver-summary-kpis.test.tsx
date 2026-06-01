// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverYearsFundedKpi } from "../solver-years-funded-kpi";
import { SolverLifetimeTaxKpi } from "../solver-lifetime-tax-kpi";

describe("solver summary KPIs", () => {
  it("renders years funded with optional delta", () => {
    render(<SolverYearsFundedKpi value={30} delta={2} />);
    expect(screen.getByText(/30/)).toBeInTheDocument();
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });
  it("renders lifetime taxes as currency", () => {
    render(<SolverLifetimeTaxKpi value={1234567} />);
    expect(screen.getByText(/\$1,234,567|\$1\.23M/)).toBeInTheDocument();
  });
});
