// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewStepIncomes from "@/components/import/review-step-incomes";

describe("ReviewStepIncomes reconciliation notice", () => {
  it("marks a superseded income row and explains why", () => {
    render(
      <ReviewStepIncomes
        incomes={[
          { type: "salary", name: "Salary at Mount Sinai", annualAmount: 239550,
            match: { kind: "new" } },
          { type: "salary", name: "W-2 Wages - Mount Sinai", annualAmount: 250000,
            match: { kind: "new" },
            reconciliation: {
              supersededBy: "Salary at Mount Sinai",
              reason: "Same employer (Mount Sinai), same year (2026) — the same earnings measured twice, not additional pay.",
            } },
        ]}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2056}
      />,
    );
    expect(screen.getByText(/W-2 Wages - Mount Sinai/)).toBeInTheDocument();
    expect(screen.getByText(/the same earnings measured twice/i)).toBeInTheDocument();
    expect(screen.getByText(/won.t be imported/i)).toBeInTheDocument();
    // Mark, never drop: the superseded row keeps its editable fields alongside
    // the row that beat it, so the advisor can still correct the decision.
    expect(screen.getAllByPlaceholderText("Income source name")).toHaveLength(2);
    expect(screen.getByDisplayValue("250,000")).toBeInTheDocument();
  });

  it("leaves an unreconciled list unflagged", () => {
    render(
      <ReviewStepIncomes
        incomes={[{ type: "salary", name: "Salary at Mount Sinai", annualAmount: 239550 }]}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2056}
      />,
    );
    expect(screen.queryByText(/won.t be imported/i)).toBeNull();
  });
});
