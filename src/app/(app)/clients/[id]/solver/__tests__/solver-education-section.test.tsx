// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverEducationSection } from "../solver-education-section";
import type { ClientData, Expense } from "@/engine/types";

const goal: Expense = {
  id: "goal-1",
  type: "education",
  name: "College — Emma",
  annualAmount: 30000,
  startYear: 2032,
  endYear: 2035,
  growthRate: 0.05,
  dedicatedAccountIds: ["529-emma"],
  payShortfallOutOfPocket: false,
} as unknown as Expense;

const workingTree = {
  expenses: [goal],
  accounts: [
    {
      id: "529-emma",
      name: "529 — Emma",
      category: "cash",
      subType: "529",
      owners: [{ kind: "family_member", familyMemberId: "emma", percent: 100 }],
    },
  ],
  savingsRules: [
    { id: "r1", accountId: "529-emma", annualAmount: 6000, isDeductible: false, startYear: 2026, endYear: 2035 },
  ],
  incomes: [],
} as unknown as ClientData;

describe("SolverEducationSection", () => {
  it("lists goals and removes one via expense-upsert null", () => {
    const onChange = vi.fn();
    render(
      <SolverEducationSection
        baseExpenses={[goal]}
        workingTree={workingTree}
        currentYear={2026}
        clientId="c1"
        source="base"
        mutations={[]}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("College — Emma")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove college — emma/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: "expense-upsert", id: "goal-1", value: null });
  });
});
