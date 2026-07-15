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

  it("adds a goal with a new 529, emitting account → rule → expense in order", () => {
    const onChange = vi.fn();
    const tree = {
      ...workingTree,
      familyMembers: [{ id: "emma", role: "child", firstName: "Emma", lastName: null }],
    } as unknown as ClientData;
    render(
      <SolverEducationSection
        baseExpenses={[goal]}
        workingTree={tree}
        currentYear={2026}
        growth529={0.06}
        clientId="c1"
        source="base"
        mutations={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add education goal/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "College — Emma" } });
    fireEvent.change(screen.getByLabelText("For"), { target: { value: "emma" } });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2032" } });
    fireEvent.change(screen.getByLabelText("Number of years"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /new 529 plan/i }));
    fireEvent.change(screen.getByLabelText("Starting balance"), { target: { value: "15000" } });
    fireEvent.change(screen.getByLabelText("Annual contribution"), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    const kinds = onChange.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(["account-upsert", "savings-rule-upsert", "expense-upsert"]);
    const accountMut = onChange.mock.calls[0][0];
    expect(accountMut.value).toMatchObject({
      category: "education_savings",
      education529: { beneficiaryFamilyMemberId: "emma" },
    });
    const expenseMut = onChange.mock.calls[2][0];
    expect(expenseMut.value.forFamilyMemberId).toBe("emma");
    expect(expenseMut.value.dedicatedAccountIds).toContain(accountMut.id);
  });
});
