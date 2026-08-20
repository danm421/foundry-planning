// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData, Income } from "@/engine";
import { incomeDetailRows, SolverRowIncomes } from "../solver-row-incomes";
import type { CashflowFormContext } from "../solver-cashflow-edit-dialog";

function income(p: Partial<Income>): Income {
  return {
    id: "i1",
    type: "salary",
    owner: "client",
    annualAmount: 100000,
    taxType: "earned_income",
    growthSource: "custom",
    growthRate: 0.02,
    ...p,
  } as Income;
}

describe("incomeDetailRows", () => {
  it("maps tax type and a custom growth rate", () => {
    expect(incomeDetailRows(income({}))).toEqual([
      { term: "Taxed as", value: "earned" },
      { term: "Growth", value: "2%" },
    ]);
  });

  it("renders inflation-linked growth and a self-employment tag", () => {
    expect(
      incomeDetailRows(income({ growthSource: "inflation", isSelfEmployment: true })),
    ).toEqual([
      { term: "Taxed as", value: "earned" },
      { value: "SE" },
      { term: "Growth", value: "infl-linked" },
    ]);
  });

  it("adds a Through row when an end year is set", () => {
    expect(incomeDetailRows(income({ endYear: 2050 }))).toEqual([
      { term: "Taxed as", value: "earned" },
      { term: "Growth", value: "2%" },
      { term: "Through", value: "2050" },
    ]);
  });
});

const ctx: CashflowFormContext = {
  owners: [{ value: "client", label: "John" }],
  milestones: { planStart: 2026, planEnd: 2061, clientRetirement: 2045, clientEnd: 2061 },
  clientFirstName: "John",
  spouseFirstName: "Jane",
  resolvedInflationRate: 0.03,
};

function tree(incomes: Income[]): ClientData {
  return {
    client: { firstName: "John", spouseName: "Jane Doe" },
    accounts: [],
    savingsRules: [],
    incomes,
    expenses: [],
    planSettings: { planStartYear: 2026, planEndYear: 2061, inflationRate: 0.03 },
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

const salary = income({ id: "i-base", name: "Salary", startYear: 2020, endYear: 2045 });
const addedRow = income({
  id: "i-new",
  type: "other",
  name: "Rental income",
  annualAmount: 24_000,
  startYear: 2026,
  endYear: 2061,
  growthSource: "inflation",
  growthRate: 0.03,
  taxType: "ordinary_income",
});

function row(opts: {
  source: Income[];
  working: Income[];
  onChange: () => void;
  onResetField?: (keys: string[]) => void;
}) {
  return (
    <SolverRowIncomes
      baseClientData={tree(opts.source)}
      sourceClientData={tree(opts.source)}
      workingClientData={tree(opts.working)}
      currentYear={2026}
      onChange={opts.onChange}
      onResetField={opts.onResetField}
      cashflowCtx={ctx}
    />
  );
}

function renderRow(opts: { source: Income[]; working: Income[] }) {
  const onChange = vi.fn();
  render(row({ ...opts, onChange }));
  return onChange;
}

describe("SolverRowIncomes — a stream added inside the solve", () => {
  it("lists it in Other Income alongside the plan's own rows", () => {
    renderRow({ source: [salary], working: [salary, addedRow] });

    expect(screen.getByText("Other Income")).toBeInTheDocument();
    expect(screen.getByLabelText("Salary — John")).toBeInTheDocument();
    expect(screen.getByLabelText("Rental income — John")).toBeInTheDocument();
  });

  it("shows the category even when the plan had no other income at all", () => {
    // Without this the whole group returns null and the row the advisor just
    // typed has nowhere to render.
    renderRow({ source: [], working: [addedRow] });
    expect(screen.getByLabelText("Rental income — John")).toBeInTheDocument();
  });

  it("re-emits a FULL upsert when its amount is edited, never a field lever", () => {
    const onChange = renderRow({ source: [salary], working: [salary, addedRow] });
    fireEvent.change(screen.getByLabelText("Rental income — John"), {
      target: { value: "30000" },
    });

    const m = onChange.mock.calls[0][0];
    // income-annual-amount would be dropped by save-to-base's source-membership
    // guard, since the plan has no such row to patch.
    expect(m.kind).toBe("income-upsert");
    expect(m.id).toBe("i-new");
    expect(m.value.annualAmount).toBe(30000);
    // The rest of the row rides along untouched.
    expect(m.value.name).toBe("Rental income");
    expect(m.value.taxType).toBe("ordinary_income");
  });

  it("removes it with a null upsert", () => {
    const onChange = renderRow({ source: [salary], working: [salary, addedRow] });
    fireEvent.click(screen.getByRole("button", { name: /remove rental income/i }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "income-upsert",
      id: "i-new",
      value: null,
    });
  });

  it("re-seeds the inline amount after its own dialog changes it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      row({ source: [salary], working: [salary, addedRow], onChange }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^edit rental income/i }));
    fireEvent.change(screen.getByLabelText(/^annual amount$/i), {
      target: { value: "30000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // The recompute round-trips the upsert back through the working tree.
    rerender(
      row({
        source: [salary],
        working: [salary, { ...addedRow, annualAmount: 30_000 }],
        onChange,
      }),
    );
    expect(
      (screen.getByLabelText("Rental income — John") as HTMLInputElement).value,
    ).toBe("30,000");
  });

  it("re-seeds a plan row's amount when a reset reverts it", () => {
    const onChange = vi.fn();
    const onResetField = vi.fn();
    const raised = { ...salary, annualAmount: 120_000 };
    const { rerender } = render(
      row({ source: [salary], working: [raised], onChange, onResetField }),
    );
    expect((screen.getByLabelText("Salary — John") as HTMLInputElement).value).toBe(
      "120,000",
    );

    fireEvent.click(screen.getByRole("button", { name: /reset to/i }));
    expect(onResetField).toHaveBeenCalled();

    // Clearing the levers puts the base figure back in the working tree.
    rerender(row({ source: [salary], working: [salary], onChange, onResetField }));
    expect((screen.getByLabelText("Salary — John") as HTMLInputElement).value).toBe(
      "100,000",
    );
  });

  it("leaves a row the plan already had on the field lever, with no remove", () => {
    const onChange = renderRow({ source: [salary], working: [salary] });
    fireEvent.change(screen.getByLabelText("Salary — John"), { target: { value: "120000" } });

    expect(onChange.mock.calls[0][0]).toEqual({
      kind: "income-annual-amount",
      incomeId: "i-base",
      annualAmount: 120_000,
    });
    expect(screen.queryByRole("button", { name: /^remove/i })).toBeNull();
  });
});
