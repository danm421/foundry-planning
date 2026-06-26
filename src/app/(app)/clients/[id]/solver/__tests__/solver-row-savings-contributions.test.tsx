// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientData, SavingsRule } from "@/engine";
import { SolverRowSavingsContributions, savingsDetailRows } from "../solver-row-savings-contributions";

function clientData(overrides: Partial<ClientData> = {}): ClientData {
  return {
    accounts: [
      { id: "acct-1", name: "John 401(k)", category: "retirement", subType: "401k", value: 0, basis: 0, growthRate: 0.06, rmdEnabled: true, titlingType: "jtwros", owners: [] },
      { id: "acct-2", name: "Joint Brokerage", category: "taxable", subType: "brokerage", value: 0, basis: 0, growthRate: 0.05, rmdEnabled: false, titlingType: "jtwros", owners: [] },
      { id: "acct-min", name: "Additional Savings", category: "taxable", subType: "brokerage", value: 0, basis: 0, growthRate: 0.05, rmdEnabled: false, titlingType: "jtwros", owners: [] },
    ],
    savingsRules: [],
    planSettings: { inflationRate: 0.03 },
    ...overrides,
  } as unknown as ClientData;
}

const baseRule = { id: "rule-base", accountId: "acct-1", annualAmount: 5000, isDeductible: true, startYear: 2020, endYear: 2045 };
const addedRule = { id: "rule-added", accountId: "acct-2", annualAmount: 8000, isDeductible: false, startYear: 2026, endYear: 2045 };
const minSavingsRule = { id: "rule-min", accountId: "acct-min", annualAmount: 3000, isDeductible: false, startYear: 2026, endYear: 2045, fundFromExpenseReduction: true };

function renderWorking(base: ClientData, working: ClientData) {
  render(
    <SolverRowSavingsContributions
      baseClientData={base}
      workingClientData={working}
      currentYear={2026}
      onChange={vi.fn()}
      activeSolve={null}
      onSolveStart={vi.fn()}
      onSolveCancel={vi.fn()}
    />,
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

  it("shows a self-funding rule once its account is in visibleSelfFundingAccts", () => {
    const base = clientData({ savingsRules: [baseRule] });
    const working = clientData({ savingsRules: [baseRule, minSavingsRule] });
    render(
      <SolverRowSavingsContributions
        baseClientData={base}
        workingClientData={working}
        currentYear={2026}
        onChange={vi.fn()}
        activeSolve={null}
        onSolveStart={vi.fn()}
        onSolveCancel={vi.fn()}
        visibleSelfFundingAccts={new Set(["acct-min"])}
      />,
    );
    expect(screen.getByLabelText("Additional Savings")).toBeInTheDocument();
  });

  it("renders the section when only a working-added rule exists (no base rules)", () => {
    const base = clientData({ savingsRules: [] });
    const working = clientData({ savingsRules: [addedRule] });
    renderWorking(base, working);
    expect(screen.getByText("Savings Contributions")).toBeTruthy();
    expect(screen.getByLabelText("Joint Brokerage")).toBeTruthy();
  });
});

function rule(p: Partial<SavingsRule>): SavingsRule {
  return {
    id: "r1",
    accountId: "a1",
    annualAmount: 20000,
    growthSource: "custom",
    growthRate: 0.03,
    startYear: 2026,
    endYear: null,
    rothPercent: 0,
    isDeductible: true,
    applyContributionLimit: true,
    ...p,
  } as SavingsRule;
}

describe("savingsDetailRows", () => {
  it("returns a Growth row for a custom growth rate", () => {
    expect(savingsDetailRows(rule({}), 2026)).toEqual([{ term: "Growth", value: "3%" }]);
  });

  it("includes match, window, Roth, after-tax and uncapped tags", () => {
    const rows = savingsDetailRows(
      rule({
        employerMatchAmount: 5000,
        endYear: 2030,
        rothPercent: 1,
        isDeductible: false,
        applyContributionLimit: false,
      }),
      2026,
    );
    expect(rows).toEqual([
      { value: "+ $5,000 match" },
      { term: "Growth", value: "3%" },
      { term: "Window", value: "thru 2030" },
      { value: "Roth" },
      { value: "after-tax" },
      { value: "uncapped" },
    ]);
  });
});
