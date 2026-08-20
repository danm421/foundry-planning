// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverQuickAddCashflow } from "../solver-quick-add-cashflow";
import type { ClientMilestones } from "@/lib/milestones";
import type { ClientData, Income, Expense } from "@/engine/types";

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2061,
  clientRetirement: 2045,
  clientEnd: 2061,
};

const owners = [
  { value: "client" as const, label: "John" },
  { value: "spouse" as const, label: "Jane" },
  { value: "joint" as const, label: "Joint" },
];

function tree(incomes: Income[] = [], expenses: Expense[] = []): ClientData {
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes,
    expenses,
    planSettings: { planStartYear: 2026, planEndYear: 2061, inflationRate: 0.03 },
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

function renderPanel(opts: { working?: ClientData; source?: ClientData } = {}) {
  const onChange = vi.fn();
  render(
    <SolverQuickAddCashflow
      sourceClientData={opts.source ?? tree()}
      workingClientData={opts.working ?? tree()}
      owners={owners}
      milestones={milestones}
      clientFirstName="John"
      spouseFirstName="Jane"
      resolvedInflationRate={0.03}
      onChange={onChange}
    />,
  );
  return onChange;
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /add income or expense/i }));
}

describe("SolverQuickAddCashflow — adding an income", () => {
  it("emits one income-upsert carrying every field the popup collects", () => {
    const onChange = renderPanel();
    openDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Rental income" },
    });
    fireEvent.change(screen.getByLabelText(/annual amount/i), {
      target: { value: "24000" },
    });
    fireEvent.change(screen.getByLabelText(/^owner$/i), { target: { value: "spouse" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const m = onChange.mock.calls[0][0];
    expect(m.kind).toBe("income-upsert");
    expect(m.value.name).toBe("Rental income");
    expect(m.value.annualAmount).toBe(24000);
    expect(m.value.owner).toBe("spouse");
    // Growth defaults to the plan's inflation rate, per the popup's default mode.
    expect(m.value.growthSource).toBe("inflation");
    expect(m.value.growthRate).toBe(0.03);
    // A solver-added stream is a plain household "other" row.
    expect(m.value.type).toBe("other");
    // Milestone-anchored by default, same as defaultIncomeRefs gives every other
    // add-income surface — not a literal current year that never tracks the plan.
    expect(m.value.startYearRef).toBe("plan_start");
    expect(m.value.endYearRef).toBe("plan_end");
    expect(m.value.startYear).toBe(2026);
    expect(m.value.endYear).toBe(2061);
  });

  it("writes a custom growth rate when the advisor switches off inflation", () => {
    const onChange = renderPanel();
    openDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Consulting" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/^growth$/i), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText(/annual growth rate/i), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const m = onChange.mock.calls[0][0];
    expect(m.value.growthSource).toBe("custom");
    expect(m.value.growthRate).toBe(0.05);
  });

  it("refuses to submit without a name", () => {
    const onChange = renderPanel();
    openDialog();
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "1000" } });

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SolverQuickAddCashflow — adding an expense", () => {
  it("emits an expense-upsert and hides the Owner field (expenses have no household owner)", () => {
    const onChange = renderPanel();
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /^expense$/i }));

    expect(screen.queryByLabelText(/^owner$/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    const m = onChange.mock.calls[0][0];
    expect(m.kind).toBe("expense-upsert");
    expect(m.value.name).toBe("Travel");
    expect(m.value.annualAmount).toBe(12000);
    // NOT "living" — a living row starting after plan start is swept into the
    // living-expense-scale solve lever, which the advisor never asked for.
    expect(m.value.type).toBe("other");
  });
});

describe("SolverQuickAddCashflow — the added-rows list", () => {
  const added: Income = {
    id: "inc-new",
    type: "other",
    name: "Rental income",
    annualAmount: 24_000,
    startYear: 2026,
    endYear: 2061,
    growthRate: 0.03,
    growthSource: "inflation",
    owner: "client",
  };

  it("lists a working row the source tree does not have", () => {
    renderPanel({ working: tree([added]) });
    expect(screen.getByText("Rental income")).toBeInTheDocument();
    expect(screen.getByText("$24,000")).toBeInTheDocument();
  });

  it("leaves rows the source tree already had alone — no delete affordance for them", () => {
    renderPanel({ source: tree([added]), working: tree([added]) });
    expect(screen.queryByText("Rental income")).toBeNull();
  });

  it("ignores a solver-added row this popup could not have minted", () => {
    // A max-spending solve synthesizes a "living" retirement expense and
    // SolverEducationSection adds "education" goals — both land in the working
    // tree through the same expense-upsert this popup uses.
    const synthesized: Expense = {
      id: "exp-living",
      type: "living",
      name: "Retirement Living Expenses",
      annualAmount: 90_000,
      startYear: 2045,
      endYear: 2061,
      growthRate: 0.03,
    };
    const goal: Expense = { ...synthesized, id: "exp-goal", type: "education", name: "College" };
    renderPanel({ working: tree([], [synthesized, goal]) });

    expect(screen.queryByText("Retirement Living Expenses")).toBeNull();
    expect(screen.queryByText("College")).toBeNull();
  });

  it("removes an added row with a null upsert", () => {
    const onChange = renderPanel({ working: tree([added]) });
    fireEvent.click(screen.getByRole("button", { name: /remove rental income/i }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "income-upsert",
      id: "inc-new",
      value: null,
    });
  });

  it("re-edits an added row as a FULL upsert on the same id, not a field lever", () => {
    const onChange = renderPanel({ working: tree([added]) });
    fireEvent.click(screen.getByRole("button", { name: /edit rental income/i }));
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const m = onChange.mock.calls[0][0];
    // A field lever (income-annual-amount) would be silently dropped by
    // save-to-base's hasIncome() guard, since base has no such row.
    expect(m.kind).toBe("income-upsert");
    expect(m.id).toBe("inc-new");
    expect(m.value.annualAmount).toBe(30000);
  });
});
