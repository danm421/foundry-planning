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
});
