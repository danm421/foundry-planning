// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { describeSolverMutation, mutationNames } from "../describe-solver-mutation";
import { UnsavedChangesList, type UnsavedChangesListProps } from "../unsaved-changes-list";

const base = buildClientData();
const groceries = { ...base.expenses[0], id: "exp-groceries", name: "Groceries", annualAmount: 12000 };
const boatLoan = { ...base.liabilities[0], id: "liab-boat", name: "Boat loan" };
const source: ClientData = { ...base, expenses: [...base.expenses, groceries], liabilities: [...base.liabilities, boatLoan] };
const rothAccount = { ...base.accounts[1], id: "acct-new-roth", name: "Roth IRA" };
const heldTree: ClientData = { ...source, accounts: [...source.accounts, rothAccount] };

const heldEdit: SolverMutation = {
  kind: "held-change",
  op: "edit",
  targetKind: "expense",
  targetId: "exp-groceries",
  payload: { annualAmount: { from: 12000, to: 12100 } },
  saveId: "s1",
};
const heldAdd: SolverMutation = {
  kind: "held-change",
  op: "add",
  targetKind: "account",
  targetId: "acct-new-roth",
  payload: { ...rothAccount },
  saveId: "s2",
};
const heldRemove: SolverMutation = {
  kind: "held-change",
  op: "remove",
  targetKind: "liability",
  targetId: "liab-boat",
  payload: null,
  saveId: "s3",
};
const control: SolverMutation = { kind: "retirement-age", person: "client", age: 62 };

function setup(all: SolverMutation[], over: Partial<UnsavedChangesListProps> = {}) {
  const props: UnsavedChangesListProps = {
    all,
    offGroups: new Set(),
    sourceTree: source,
    workingTree: heldTree,
    canEdit: true,
    onSetGroupOn: vi.fn(),
    onDiscard: vi.fn(),
    onOpenHeld: vi.fn(),
    onOpenSolverTab: vi.fn(),
    ...over,
  };
  render(<UnsavedChangesList {...props} />);
  return props;
}

describe("UnsavedChangesList", () => {
  it("lists a control and a held edit, with Groceries · Annual amount $12,000 → $12,100", () => {
    setup([control, heldEdit]);
    expect(screen.getByText(/Retirement age/)).toBeInTheDocument();
    expect(screen.getByText("Groceries · Annual amount: $12,000 → $12,100")).toBeInTheDocument();
  });

  it("Add · Roth IRA and Remove · Boat loan", () => {
    setup([heldAdd, heldRemove]);
    expect(screen.getByText("Add · Roth IRA")).toBeInTheDocument();
    expect(screen.getByText("Remove · Boat loan")).toBeInTheDocument();
    // a held remove has nothing to reopen
    expect(screen.queryByRole("button", { name: "Remove · Boat loan" })).not.toBeInTheDocument();
  });

  it("names a switched-off held add from its own payload", () => {
    setup([heldAdd], { workingTree: source, offGroups: new Set(["save:s2"]) });
    expect(screen.getByText("Add · Roth IRA")).toBeInTheDocument();
  });

  it("one switch for a multi-item save", () => {
    const second: SolverMutation = { ...heldEdit, targetId: "exp-living", payload: { annualAmount: { from: 1, to: 2 } } };
    setup([heldEdit, second]);
    expect(screen.getAllByRole("button", { name: /^Include / })).toHaveLength(1);
    expect(screen.getByText(/Groceries · /)).toBeInTheDocument();
    expect(screen.getByText(/Living Expenses · /)).toBeInTheDocument();
  });

  it("switch calls onSetGroupOn(group, false)", () => {
    const props = setup([heldEdit]);
    fireEvent.click(screen.getByRole("button", { name: /^Include Groceries/ }));
    expect(props.onSetGroupOn).toHaveBeenCalledWith("save:s1", false);
  });

  it("switching a switched-off row calls onSetGroupOn(group, true)", () => {
    const props = setup([heldEdit], { offGroups: new Set(["save:s1"]) });
    fireEvent.click(screen.getByRole("button", { name: /^Include Groceries/ }));
    expect(props.onSetGroupOn).toHaveBeenCalledWith("save:s1", true);
  });

  it("× calls onDiscard(key)", () => {
    const props = setup([heldEdit]);
    fireEvent.click(screen.getByRole("button", { name: /^Discard Groceries/ }));
    expect(props.onDiscard).toHaveBeenCalledWith("held-change:expense:exp-groceries");
  });

  it("title reopens a held edit / jumps to the control's tab", () => {
    const props = setup([control, heldEdit]);
    fireEvent.click(screen.getByRole("button", { name: "Groceries · Annual amount: $12,000 → $12,100" }));
    expect(props.onOpenHeld).toHaveBeenCalledTimes(1);
    const [target, label] = (props.onOpenHeld as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(target).toMatchObject({ surface: "details", page: "income-expenses", focus: { kind: "expense", id: "exp-groceries" } });
    expect(label).toBe("Groceries");
    fireEvent.click(screen.getByRole("button", { name: /^Retirement age/ }));
    expect(props.onOpenSolverTab).toHaveBeenCalledWith("retirement");
  });

  it("off rows are dimmed", () => {
    setup([control, heldEdit], { offGroups: new Set(["save:s1"]) });
    expect(screen.getByTestId("unsaved-row-save:s1").className).toContain("opacity-60");
    expect(screen.getByText(/Retirement age/).closest("[data-testid]")!.className).not.toContain("opacity-60");
  });

  it("a view-only advisor cannot reopen titles", () => {
    setup([heldEdit], { canEdit: false });
    expect(screen.queryByRole("button", { name: /^Groceries ·/ })).not.toBeInTheDocument();
  });

  it("a dependant of a switched-off add reads on but dimmed, and its own switch turns it off", () => {
    const rule: SolverMutation = {
      kind: "savings-rule-upsert",
      id: "rule-new",
      value: { ...base.savingsRules[0], id: "rule-new", accountId: "acct-new-roth" },
    };
    const props = setup([heldAdd, rule], { workingTree: source, offGroups: new Set(["save:s2"]) });
    const ruleRow = screen.getByText(/^Savings/).closest("[data-testid]")!;
    expect(ruleRow.className).toContain("opacity-60");
    const sw = ruleRow.querySelector("button[aria-pressed]")!;
    expect(sw.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sw);
    expect(props.onSetGroupOn).toHaveBeenCalledWith("key:savings-rule-upsert:rule-new", false);
  });

  it("names held rows exactly as the save dialog does (savings rule, renamed item)", () => {
    const rule = base.savingsRules[0];
    const ruleEdit: SolverMutation = {
      kind: "held-change",
      op: "edit",
      targetKind: "savings_rule",
      targetId: rule.id,
      payload: { annualAmount: { from: 1000, to: 2000 } },
      saveId: "s4",
    };
    const renamed: ClientData = {
      ...source,
      expenses: source.expenses.map((e) => (e.id === "exp-groceries" ? { ...e, name: "Groceries Plus" } : e)),
    };
    const all = [ruleEdit, heldEdit];
    setup(all, { workingTree: renamed });
    const names = mutationNames(source, renamed);
    for (const m of all) {
      expect(screen.getByText(describeSolverMutation(m, names))).toBeInTheDocument();
    }
    expect(screen.getByText(/^Groceries Plus · /)).toBeInTheDocument();
  });
});
