// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectionYear } from "@/engine/types";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income";
import { TaxDetailStateTable } from "../tax-detail-state-table";

function makeStateResult(
  overrides: Partial<StateIncomeTaxResult> = {},
): StateIncomeTaxResult {
  return {
    state: "CA",
    year: 2026,
    hasIncomeTax: true,
    incomeBase: "federal-agi",
    startingIncome: 120_000,
    addbacks: { taxFreeInterest: 0, other: 0, total: 0 },
    subtractions: {
      socialSecurity: 0,
      retirementIncome: 0,
      capitalGains: 0,
      preTaxContrib: 0,
      other: 0,
      total: 0,
    },
    stateAGI: 120_000,
    stdDeduction: 10_540,
    personalExemptionDeduction: 0,
    exemptionCredits: 280,
    stateTaxableIncome: 109_460,
    filingStatusUsed: "married_joint",
    stateFilingStatusUsed: "joint",
    bracketsUsed: [],
    preCreditTax: 4_974,
    specialRulesApplied: [],
    stateTax: 4_694,
    diag: { notes: [] },
    ...overrides,
  };
}

function makeYear(state: StateIncomeTaxResult, year = 2026): ProjectionYear {
  return {
    year,
    ages: { client: 50, spouse: 50 },
    taxResult: {
      income: {
        earnedIncome: 120_000,
        taxableSocialSecurity: 0,
        ordinaryIncome: 0,
        dividends: 0,
        capitalGains: 0,
        shortCapitalGains: 0,
        totalIncome: 120_000,
        nonTaxableIncome: 0,
        grossTotalIncome: 120_000,
      },
      state,
    },
  } as unknown as ProjectionYear;
}

describe("TaxDetailStateTable", () => {
  it("renders the year, federal base, and computed state tax for a CA year", () => {
    const state = makeStateResult();
    const year = makeYear(state);
    render(
      <TaxDetailStateTable years={[year]} onYearClick={() => {}} />,
    );
    expect(screen.getByText("2026")).toBeTruthy();
    // $4,694 state tax should render
    expect(screen.getByText("$4,694")).toBeTruthy();
    // Federal base $120,000 (appears in Federal Base + State AGI columns)
    expect(screen.getAllByText("$120,000").length).toBeGreaterThan(0);
  });

  it("renders the no-tax banner when hasIncomeTax is false (e.g. FL)", () => {
    const state = makeStateResult({
      state: "FL",
      hasIncomeTax: false,
      startingIncome: 0,
      stateAGI: 0,
      stdDeduction: 0,
      stateTaxableIncome: 0,
      preCreditTax: 0,
      exemptionCredits: 0,
      stateTax: 0,
    });
    const year = makeYear(state);
    render(
      <TaxDetailStateTable years={[year]} onYearClick={() => {}} />,
    );
    expect(screen.getByText(/does not levy a personal income tax/i)).toBeTruthy();
    expect(screen.getByText(/Florida/i)).toBeTruthy();
  });

  it("calls onYearClick when the year cell is clicked", async () => {
    const user = userEvent.setup();
    const onYearClick = vi.fn();
    const state = makeStateResult();
    const year = makeYear(state);
    render(
      <TaxDetailStateTable years={[year]} onYearClick={onYearClick} />,
    );
    await user.click(screen.getByText("2026"));
    expect(onYearClick).toHaveBeenCalledWith(year);
  });

  it("falls back to the empty-data message when years have no state result", () => {
    const year = { year: 2026, ages: { client: 50 }, taxResult: {} } as unknown as ProjectionYear;
    render(
      <TaxDetailStateTable years={[year]} onYearClick={() => {}} />,
    );
    expect(screen.getByText(/No state-tax detail available/i)).toBeTruthy();
  });
});
