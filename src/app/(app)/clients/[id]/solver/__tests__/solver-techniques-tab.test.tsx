// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverTechniquesTab } from "../solver-techniques-tab";
import type { ClientData } from "@/engine/types";

const rc = {
  id: "rc-1",
  name: "Existing Conv",
  destinationAccountId: "a",
  sourceAccountIds: ["b"],
  conversionType: "fixed_amount" as const,
  fixedAmount: 25000,
  startYear: 2030,
  endYear: 2035,
  indexingRate: 0,
};

function tree(rothConversions = [] as (typeof rc)[]): ClientData {
  return { accounts: [], rothConversions } as unknown as ClientData;
}

const baseProps = {
  clientId: "c1",
  accounts: [],
  liabilities: [],
  modelPortfolios: [],
  milestones: undefined,
};

describe("SolverTechniquesTab", () => {
  it("lists base techniques read-only and working techniques editable", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}
        baseClientData={tree([rc])}
        workingTree={tree([rc])}
        onChange={vi.fn()}
      />,
    );
    // The existing conversion appears in both columns.
    expect(screen.getAllByText("Existing Conv").length).toBe(2);
    // Working column exposes an Add control per group.
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
  });

  it("shows a quiet placeholder (no Add control) for an empty Base column", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}
        baseClientData={tree([])}
        workingTree={tree([])}
        onChange={vi.fn()}
      />,
    );
    // Base column renders a non-interactive placeholder per technique group.
    expect(screen.getByText("No Roth conversions")).toBeTruthy();
    expect(screen.getByText("No asset transactions")).toBeTruthy();
    expect(screen.getByText("No reinvestments")).toBeTruthy();
    // The only "Add" affordance lives in the Scenario (working) column.
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
  });

  it("emits a removal mutation when a working row's Remove is clicked", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        baseClientData={tree([rc])}
        workingTree={tree([rc])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove technique/i }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "roth-conversion-upsert",
      id: "rc-1",
      value: null,
    });
  });

  it("shows a Solve control only for fixed-amount roth conversions and fires onSolveStart", () => {
    const onSolveStart = vi.fn();
    const fixedRc = { ...rc, id: "rc-fixed", conversionType: "fixed_amount" as const };
    const fullRc = { ...rc, id: "rc-full", conversionType: "full_account" as const };
    render(
      <SolverTechniquesTab
        {...baseProps}
        baseClientData={tree([])}
        workingTree={tree([fixedRc, fullRc] as (typeof rc)[])}
        onChange={vi.fn()}
        onSolveStart={onSolveStart}
      />,
    );
    const solveButtons = screen.getAllByRole("button", { name: /solve/i });
    expect(solveButtons).toHaveLength(1); // only the fixed-amount conversion
    fireEvent.click(solveButtons[0]);
    expect(onSolveStart).toHaveBeenCalledWith(
      { kind: "roth-conversion-amount", techniqueId: "rc-fixed" },
      expect.any(Number),
    );
  });
});
