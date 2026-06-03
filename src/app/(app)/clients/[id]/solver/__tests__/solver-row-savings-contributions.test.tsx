// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverRowSavingsContributions } from "../solver-row-savings-contributions";
import { SolverSideContext } from "../solver-section";

function clientData(overrides: any = {}) {
  return {
    accounts: [
      { id: "acct-1", name: "John 401(k)", category: "retirement", subType: "401k", value: 0, basis: 0, growthRate: 0.06, rmdEnabled: true, titlingType: "jtwros", owners: [] },
      { id: "acct-2", name: "Joint Brokerage", category: "taxable", subType: "brokerage", value: 0, basis: 0, growthRate: 0.05, rmdEnabled: false, titlingType: "jtwros", owners: [] },
      { id: "acct-min", name: "Additional Savings", category: "taxable", subType: "brokerage", value: 0, basis: 0, growthRate: 0.05, rmdEnabled: false, titlingType: "jtwros", owners: [] },
    ],
    savingsRules: [],
    planSettings: { inflationRate: 0.03 },
    ...overrides,
  };
}

const baseRule = { id: "rule-base", accountId: "acct-1", annualAmount: 5000, isDeductible: true, startYear: 2020, endYear: 2045 };
const addedRule = { id: "rule-added", accountId: "acct-2", annualAmount: 8000, isDeductible: false, startYear: 2026, endYear: 2045 };
const minSavingsRule = { id: "rule-min", accountId: "acct-min", annualAmount: 3000, isDeductible: false, startYear: 2026, endYear: 2045, fundFromExpenseReduction: true };

function renderWorking(base: any, working: any) {
  render(
    <SolverSideContext.Provider value="working">
      <SolverRowSavingsContributions
        baseClientData={base}
        workingClientData={working}
        currentYear={2026}
        onChange={vi.fn()}
        activeSolve={null}
        onSolveStart={vi.fn()}
        onSolveCancel={vi.fn()}
      />
    </SolverSideContext.Provider>,
  );
}

describe("SolverRowSavingsContributions working-added rows", () => {
  it("renders a working-only active rule as an editable row", () => {
    const base = clientData({ savingsRules: [baseRule] });
    const working = clientData({ savingsRules: [baseRule, addedRule] });
    renderWorking(base, working);
    expect(screen.getByLabelText("Joint Brokerage")).toBeTruthy(); // the editable input
  });

  it("excludes the synthetic min-savings (fundFromExpenseReduction) rule", () => {
    const base = clientData({ savingsRules: [baseRule] });
    const working = clientData({ savingsRules: [baseRule, minSavingsRule] });
    renderWorking(base, working);
    expect(screen.queryByLabelText("Additional Savings")).toBeNull();
  });

  it("renders the section when only a working-added rule exists (no base rules)", () => {
    const base = clientData({ savingsRules: [] });
    const working = clientData({ savingsRules: [addedRule] });
    renderWorking(base, working);
    expect(screen.getByText("Savings Contributions")).toBeTruthy();
    expect(screen.getByLabelText("Joint Brokerage")).toBeTruthy();
  });
});
