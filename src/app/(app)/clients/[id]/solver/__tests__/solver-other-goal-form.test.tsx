// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverOtherGoalForm } from "../solver-other-goal-form";
import type { Expense } from "@/engine/types";

const ACCOUNTS = [
  { id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["fm-1"] },
  { id: "p529", name: "College 529", category: "education_savings", subType: "529" },
  { id: "chk", name: "Household Checking", category: "cash", subType: "checking", ownerFamilyMemberIds: ["fm-1"], isDefaultChecking: true },
];
const OWNERS = [{ familyMemberId: "fm-1", label: "Harold" }];

function renderForm(overrides: Partial<Parameters<typeof SolverOtherGoalForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <SolverOtherGoalForm
      mode="add"
      accounts={ACCOUNTS}
      owners={OWNERS}
      growthTaxable={0.06}
      inflationRate={0.025}
      currentYear={2026}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
  return onSubmit;
}

describe("SolverOtherGoalForm", () => {
  it("never offers a 529 or the main checking account", () => {
    renderForm();
    expect(screen.getByRole("checkbox", { name: "Brokerage" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "College 529" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Household Checking" })).toBeNull();
  });

  it("adds a one-year goal funded by a new savings account: account → rule, then the expense", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New car" } });
    fireEvent.change(screen.getByLabelText("Annual cost"), { target: { value: "60000" } });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2029" } });
    fireEvent.click(screen.getByRole("button", { name: /new savings account/i }));
    fireEvent.change(screen.getByLabelText("Starting balance"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Annual contribution"), { target: { value: "12000" } });
    expect((screen.getByLabelText(/pay shortfall out of pocket/i) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    const [expense, mutations] = onSubmit.mock.calls[0];
    expect(mutations.map((m: { kind: string }) => m.kind)).toEqual(["account-upsert", "savings-rule-upsert"]);
    expect(mutations[0].value).toMatchObject({
      category: "taxable", subType: "brokerage", value: 10000,
      owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
    });
    expect(mutations[1].value).toMatchObject({ annualAmount: 12000, startYear: 2026, endYear: 2029 });
    expect(expense).toMatchObject({
      type: "other", isGoal: true, name: "New car", annualAmount: 60000,
      startYear: 2029, endYear: 2029, growthRate: 0.025, payShortfallOutOfPocket: true,
    });
    expect(expense.dedicatedAccountIds).toEqual([mutations[0].id]);
  });

  it("keeps an edited goal's other fields, and drops its milestone anchors when its years move", () => {
    const initial = {
      id: "car", type: "other", name: "Car", annualAmount: 50000, startYear: 2030, endYear: 2030,
      growthRate: 0.03, isGoal: true, deductionType: null, cashAccountId: "chk",
      startYearRef: "client_retirement", endYearRef: "client_retirement", dedicatedAccountIds: [],
    } as unknown as Expense;
    const onSubmit = renderForm({ mode: "edit", initial });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2031" } });
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));
    const [expense] = onSubmit.mock.calls[0];
    expect(expense).toMatchObject({ id: "car", cashAccountId: "chk", startYear: 2031, startYearRef: null, endYearRef: null });
  });
});
