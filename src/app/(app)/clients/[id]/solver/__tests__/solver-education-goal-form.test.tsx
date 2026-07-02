// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverEducationGoalForm } from "../solver-education-goal-form";

const accounts = [{ id: "529-emma", name: "529 — Emma", category: "cash", subType: "529", ownerFamilyMemberIds: ["emma"] }];

describe("SolverEducationGoalForm", () => {
  it("submits a well-formed education expense", () => {
    const onSubmit = vi.fn();
    render(
      <SolverEducationGoalForm mode="add" accounts={accounts} currentYear={2026} onSubmit={onSubmit} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "College — Emma" } });
    fireEvent.change(screen.getByLabelText("Annual cost"), { target: { value: "30000" } });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2032" } });
    fireEvent.change(screen.getByLabelText("Number of years"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("529 — Emma"));
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const expense = onSubmit.mock.calls[0][0];
    expect(expense).toMatchObject({
      type: "education", name: "College — Emma", annualAmount: 30000,
      startYear: 2032, endYear: 2035, dedicatedAccountIds: ["529-emma"],
    });
    expect(typeof expense.id).toBe("string");
  });
});
