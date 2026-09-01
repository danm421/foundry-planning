// @vitest-environment jsdom
/**
 * The Solver's savings editor is the FOURTH mount of Task 4's
 * `SalaryBasisFields`. Each earlier mount broke differently — one dropped the
 * stored choice on save, one never seeded it — so this file pins the whole
 * round trip for this mount: seed from the working rule, stay silent when
 * nothing moved, and emit a `savings-salary-basis` mutation when it did.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { ClientMilestones } from "@/lib/milestones";
import { SolverSavingsEditDialog } from "../solver-savings-edit-dialog";

const MILESTONES: ClientMilestones = {
  planStart: 2026, planEnd: 2075, clientRetirement: 2044, clientEnd: 2060,
};

const ACCOUNT = {
  id: "acct-401k",
  name: "Harold 401(k)",
  category: "retirement",
  subType: "401k",
} as unknown as Account;

const SALARIES = [
  { id: "inc-h", name: "Base Salary", ownerLabel: "Harold" },
  { id: "inc-m", name: "Base Salary", ownerLabel: "Maude" },
];

function rule(over: Partial<SavingsRule> = {}): SavingsRule {
  return {
    id: "sr-1",
    accountId: "acct-401k",
    annualAmount: 0,
    annualPercent: 0.1,
    startYear: 2026,
    endYear: 2045,
    isDeductible: true,
    ...over,
  } as unknown as SavingsRule;
}

function renderDialog(workingRule: SavingsRule) {
  const onEmit = vi.fn();
  render(
    <SolverSavingsEditDialog
      open
      onClose={vi.fn()}
      onEmit={onEmit}
      account={ACCOUNT}
      workingRule={workingRule}
      resolvedInflationRate={0.03}
      salaries={SALARIES}
      milestones={MILESTONES}
    />,
  );
  return onEmit;
}

const emitted = (onEmit: ReturnType<typeof vi.fn>): SolverMutation[] =>
  (onEmit.mock.calls[0]?.[0] as SolverMutation[]) ?? [];

describe("SolverSavingsEditDialog — salary basis", () => {
  it("seeds the panel from the working rule's stored choice", () => {
    renderDialog(rule({ salaryBasis: "selected", salaryIncomeIds: ["inc-m"] }));
    expect((screen.getByLabelText("Base Salary — Maude") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Base Salary — Harold") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("All salaries") as HTMLInputElement).checked).toBe(false);
  });

  it("emits nothing for the basis when the advisor did not touch it", async () => {
    const onEmit = renderDialog(rule({ salaryBasis: "selected", salaryIncomeIds: ["inc-m"] }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(emitted(onEmit).some((m) => m.kind === "savings-salary-basis")).toBe(false);
  });

  it("emits the basis and ids the advisor chose", async () => {
    const onEmit = renderDialog(rule({ salaryBasis: "selected", salaryIncomeIds: ["inc-m"] }));
    await userEvent.click(screen.getByLabelText("Base Salary — Harold"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    // Both boxes checked means "all of them", including salaries added later.
    expect(emitted(onEmit)).toContainEqual({
      kind: "savings-salary-basis",
      accountId: "acct-401k",
      basis: "all",
      incomeIds: [],
    });
  });

  it("promotes a rule that predates the column from owner to selected", async () => {
    const onEmit = renderDialog(rule());
    expect((screen.getByLabelText("All salaries") as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByLabelText("Base Salary — Maude"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(emitted(onEmit)).toContainEqual({
      kind: "savings-salary-basis",
      accountId: "acct-401k",
      basis: "selected",
      incomeIds: ["inc-m"],
    });
  });

  it("hides the panel in dollar mode, where nothing reads salary", () => {
    renderDialog(rule({ annualPercent: null, annualAmount: 20000 }));
    expect(screen.queryByText("Salary basis")).toBeNull();
  });
});
