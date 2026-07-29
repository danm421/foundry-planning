// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewStepSavings from "@/components/import/review-step-savings";

const ROWS = [
  {
    name: "Zach 401(k): Pre-Tax Contribution",
    destinationAccountName: "Zach 401(k)",
    owner: "client" as const,
    annualPercent: 0.1,
    match: { kind: "new" as const },
  },
  {
    name: "Taxable: Annual Contribution",
    destinationAccountName: "Taxable Investment 1",
    owner: "client" as const,
    annualAmount: 12000,
    match: { kind: "new" as const },
  },
];

describe("ReviewStepSavings", () => {
  it("shows a percent contribution as a percent", () => {
    render(<ReviewStepSavings rows={ROWS} onChange={() => {}} />);
    expect(screen.getByText("10% of salary")).toBeInTheDocument();
  });

  it("shows a flat contribution as dollars per year", () => {
    render(<ReviewStepSavings rows={ROWS} onChange={() => {}} />);
    expect(screen.getByText("$12,000/yr")).toBeInTheDocument();
  });

  it("names the destination account", () => {
    render(<ReviewStepSavings rows={ROWS} onChange={() => {}} />);
    expect(screen.getByText("Zach 401(k)")).toBeInTheDocument();
  });

  it("renders an empty state when there is nothing to review", () => {
    render(<ReviewStepSavings rows={[]} onChange={() => {}} />);
    expect(screen.getByText(/no savings/i)).toBeInTheDocument();
  });
});
