// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverQuickAddCashflow } from "../solver-quick-add-cashflow";
import type { CashflowFormContext } from "../solver-cashflow-edit-dialog";
import type { ClientMilestones } from "@/lib/milestones";

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2061,
  clientRetirement: 2045,
  clientEnd: 2061,
};

const ctx: CashflowFormContext = {
  owners: [
    { value: "client", label: "John" },
    { value: "spouse", label: "Jane" },
    { value: "joint", label: "Joint" },
  ],
  milestones,
  clientFirstName: "John",
  spouseFirstName: "Jane",
  resolvedInflationRate: 0.03,
};

function renderPanel() {
  const onChange = vi.fn();
  render(<SolverQuickAddCashflow ctx={ctx} onChange={onChange} />);
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
    // Untouched, the treatment select still hands the engine a taxable stream.
    expect(m.value.taxType).toBe("ordinary_income");
  });

  it("writes the chosen tax treatment onto the income", () => {
    const onChange = renderPanel();
    openDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Muni interest" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "8000" } });
    fireEvent.change(screen.getByLabelText(/tax treatment/i), {
      target: { value: "tax_exempt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onChange.mock.calls[0][0].value.taxType).toBe("tax_exempt");
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
  it("emits an expense-upsert and hides the income-only fields", () => {
    const onChange = renderPanel();
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /^expense$/i }));

    // An Expense carries no household owner anywhere in the app, and no tax
    // treatment — both are income-only concepts.
    expect(screen.queryByLabelText(/^owner$/i)).toBeNull();
    expect(screen.queryByLabelText(/tax treatment/i)).toBeNull();

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
