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
  it("renders an existing working technique with an Add control", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([rc])}
        onChange={vi.fn()}
      />,
    );
    // The existing conversion appears once on the always-editable surface.
    expect(screen.getAllByText("Existing Conv").length).toBe(1);
    // The Add control is always present for each technique group.
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
  });

  it("shows Add controls as the empty state when no techniques are present", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([])}
        onChange={vi.fn()}
      />,
    );
    // The always-editable surface uses add-tiles as empty state (no read-only placeholders).
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
    expect(
      screen.getAllByRole("button", { name: /add asset transaction/i }).length,
    ).toBe(1);
    expect(
      screen.getAllByRole("button", { name: /add reinvestment/i }).length,
    ).toBe(1);
  });

  it("emits a removal mutation when a working row's Remove is clicked", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([rc])}
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
        {...baseProps}        workingTree={tree([fixedRc, fullRc] as (typeof rc)[])}
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
