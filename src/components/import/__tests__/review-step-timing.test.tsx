// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewStepIncomes from "@/components/import/review-step-incomes";
import type { ClientMilestones } from "@/lib/milestones";

const milestones: ClientMilestones = {
  planStart: 2026, planEnd: 2061, clientRetirement: 2035, clientEnd: 2061,
};
const income = [{ name: "Salary", type: "salary" as const, startYear: 2026, endYear: 2035 }];

describe("ReviewStepIncomes timing inputs", () => {
  it("renders the milestone picker when milestones are provided", () => {
    render(
      <ReviewStepIncomes
        incomes={income}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2056}
        milestones={milestones}
        clientFirstName="John"
      />,
    );
    // MilestoneYearPicker renders a <select> whose first option is "Manual".
    expect(screen.getAllByRole("option", { name: "Manual" }).length).toBeGreaterThan(0);
  });

  it("falls back to plain number inputs when milestones are absent", () => {
    render(
      <ReviewStepIncomes
        incomes={income}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2056}
      />,
    );
    expect(screen.queryByRole("option", { name: "Manual" })).toBeNull();
  });
});
