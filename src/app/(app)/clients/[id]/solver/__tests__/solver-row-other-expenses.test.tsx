// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData, Expense } from "@/engine";
import { SolverRowOtherExpenses } from "../solver-row-other-expenses";
import type { CashflowFormContext } from "../solver-cashflow-edit-dialog";

const ctx: CashflowFormContext = {
  owners: [{ value: "client", label: "John" }],
  milestones: { planStart: 2026, planEnd: 2061, clientRetirement: 2045, clientEnd: 2061 },
  clientFirstName: "John",
  spouseFirstName: "Jane",
  resolvedInflationRate: 0.03,
};

function expense(p: Partial<Expense>): Expense {
  return {
    id: "e1",
    type: "other",
    name: "Travel",
    annualAmount: 12_000,
    startYear: 2026,
    endYear: 2061,
    growthRate: 0.03,
    growthSource: "inflation",
    ...p,
  } as Expense;
}

function tree(expenses: Expense[]): ClientData {
  return {
    client: { firstName: "John" },
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses,
    planSettings: { planStartYear: 2026, planEndYear: 2061, inflationRate: 0.03 },
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

const planned = expense({ id: "e-base", name: "Travel" });
const addedRow = expense({ id: "e-new", name: "Boat", annualAmount: 20_000 });

function renderRow(opts: { source: Expense[]; working: Expense[] }) {
  const onChange = vi.fn();
  render(
    <SolverRowOtherExpenses
      baseClientData={tree(opts.source)}
      sourceClientData={tree(opts.source)}
      workingClientData={tree(opts.working)}
      currentYear={2026}
      onChange={onChange}
      cashflowCtx={ctx}
    />,
  );
  return onChange;
}

describe("SolverRowOtherExpenses", () => {
  it("renders nothing when the plan has no other expenses and none were added", () => {
    const { container } = render(
      <SolverRowOtherExpenses
        baseClientData={tree([])}
        sourceClientData={tree([])}
        workingClientData={tree([])}
        currentYear={2026}
        onChange={vi.fn()}
        cashflowCtx={ctx}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("edits one of the plan's own rows with the amount lever", () => {
    const onChange = renderRow({ source: [planned], working: [planned] });
    expect(screen.getByText("Other Expenses")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Travel"), { target: { value: "15000" } });
    expect(onChange.mock.calls[0][0]).toEqual({
      kind: "expense-annual-amount",
      expenseId: "e-base",
      annualAmount: 15_000,
    });
  });

  it("lists an expense added inside the solve, editable as a full upsert", () => {
    const onChange = renderRow({ source: [planned], working: [planned, addedRow] });
    expect(screen.getByLabelText("Boat")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Boat"), { target: { value: "25000" } });
    const m = onChange.mock.calls[0][0];
    // expense-annual-amount would be dropped by save-to-base's source-membership
    // guard, since the plan has no such row to patch.
    expect(m.kind).toBe("expense-upsert");
    expect(m.id).toBe("e-new");
    expect(m.value.annualAmount).toBe(25_000);
    expect(m.value.name).toBe("Boat");
  });

  it("removes an added expense with a null upsert", () => {
    const onChange = renderRow({ source: [planned], working: [planned, addedRow] });
    fireEvent.click(screen.getByRole("button", { name: /remove boat/i }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "expense-upsert",
      id: "e-new",
      value: null,
    });
  });

  it("ignores rows the quick-add popup could not have minted", () => {
    // A max-spending solve synthesizes a "living" retirement expense and
    // SolverEducationSection adds "education" goals — both land in the working
    // tree through the same expense-upsert this category's rows use.
    const synthesized = expense({
      id: "e-living",
      type: "living",
      name: "Retirement Living Expenses",
      startYear: 2045,
    });
    const goal = expense({ id: "e-goal", type: "education", name: "College" });
    renderRow({ source: [], working: [synthesized, goal] });

    expect(screen.queryByText("Retirement Living Expenses")).toBeNull();
    expect(screen.queryByText("College")).toBeNull();
  });

  it("hides a planned row whose window has closed, but never a just-added one", () => {
    const lapsed = expense({ id: "e-old", name: "Daycare", endYear: 2024 });
    const future = expense({ id: "e-fut", name: "Boat", startYear: 2045 });
    renderRow({ source: [lapsed], working: [lapsed, future] });

    expect(screen.queryByLabelText("Daycare")).toBeNull();
    expect(screen.getByLabelText("Boat")).toBeInTheDocument();
  });
});
