// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverEducationGoalForm } from "../solver-education-goal-form";

const accounts = [{ id: "529-emma", name: "529 — Emma", category: "cash", subType: "529", ownerFamilyMemberIds: ["emma"] }];
const beneficiaries = [
  { familyMemberId: "emma", label: "Emma" },
  { familyMemberId: "liam", label: "Liam" },
];

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
    expect(onSubmit.mock.calls[0][1]).toEqual([]);
  });

  it("sets forFamilyMemberId from the For select", () => {
    const onSubmit = vi.fn();
    render(
      <SolverEducationGoalForm
        mode="add" accounts={accounts} beneficiaries={beneficiaries}
        currentYear={2026} onSubmit={onSubmit} onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("For"), { target: { value: "liam" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    expect(onSubmit.mock.calls[0][0].forFamilyMemberId).toBe("liam");
  });

  it("creates a new 529 (account + rule) linked as a dedicated funding source", () => {
    const onSubmit = vi.fn();
    render(
      <SolverEducationGoalForm
        mode="add" accounts={accounts} beneficiaries={beneficiaries} growth529={0.06}
        currentYear={2026} onSubmit={onSubmit} onCancel={() => {}}
      />,
    );
    // The 529 trigger is disabled until a "For" person is chosen.
    expect(screen.getByRole("button", { name: /new 529 plan/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("For"), { target: { value: "emma" } });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2032" } });
    fireEvent.change(screen.getByLabelText("Number of years"), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: /new 529 plan/i }));
    fireEvent.change(screen.getByLabelText("Starting balance"), { target: { value: "15000" } });
    fireEvent.change(screen.getByLabelText("Annual contribution"), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    const [expense, mutations] = onSubmit.mock.calls[0];
    // Account-upsert first, then its savings rule.
    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toMatchObject({
      kind: "account-upsert",
      value: { category: "education_savings", subType: "529", value: 15000, education529: { beneficiaryFamilyMemberId: "emma" } },
    });
    expect(mutations[1]).toMatchObject({ kind: "savings-rule-upsert", value: { annualAmount: 6000, isDeductible: false, endYear: 2035 } });
    // The new 529 is wired into the goal's dedicated funding, in draw order.
    const new529Id = mutations[0].id;
    expect(expense.dedicatedAccountIds).toContain(new529Id);
  });
});
