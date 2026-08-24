// @vitest-environment jsdom
/**
 * The coverage line under the solver's Disability stressor.
 *
 * An advisor toggling "Disability" is asking two questions at once: what stops,
 * and what pays. The row already answered the first. This file pins the second
 * — and pins it to the ENGINE'S numbers: every figure asserted here comes out of
 * `resolveCoveredEarnings` / `resolveCoverage` / `benefitForYear`, the same
 * three functions the projection pays on. A second derivation on the UI side is
 * how a screen and its engine drift apart.
 *
 * $93,913 is not arithmetic done here. It is the engine's own 2028 figure for a
 * workplace policy on $159,135 of covered earnings (150,000 x 1.03^2), where the
 * 7-day and 90-day elimination periods are unpaid time inside the year:
 *   2028 => 93,912.52   2029 => 95,481.00   2035 => 0 (benefit period ends at 65)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientData, DisabilityPolicy, Income } from "@/engine/types";
import { SolverStressTestTab } from "../solver-stress-test-tab";

const CURRENT_YEAR = 2026;
const DISABILITY_YEAR = 2028;

/** The one-click workplace package: 60% short-term for 13 weeks after a 7-day
 *  wait, then 60% long-term to age 65 after a 90-day wait. */
const workplace: DisabilityPolicy = {
  id: "dp-work",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
};

const clientSalary: Income = {
  id: "inc-salary-client",
  type: "salary",
  name: "John Salary",
  annualAmount: 150_000,
  startYear: 2026,
  endYear: 2035,
  growthRate: 0.03,
  owner: "client",
};

function tree(over: {
  disabilityPolicies?: DisabilityPolicy[];
  disabilityEvent?: { person: "client" | "spouse"; startYear: number };
  incomes?: Income[];
  spouseDob?: string | undefined;
}): ClientData {
  return {
    client: {
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: "married_joint",
      spouseName: "Jane Smith",
      spouseDob: "spouseDob" in over ? over.spouseDob : "1972-06-15",
      spouseRetirementAge: 65,
    },
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2055,
      disabilityEvent: over.disabilityEvent,
    },
    accounts: [],
    incomes: over.incomes ?? [clientSalary],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    familyMembers: [],
    giftEvents: [],
    disabilityPolicies: over.disabilityPolicies ?? [],
  } as unknown as ClientData;
}

function renderTab(over: Parameters<typeof tree>[0]) {
  const working = tree(over);
  render(
    <SolverStressTestTab
      baseClientData={tree({ spouseDob: over.spouseDob })}
      workingTree={working}
      currentYear={CURRENT_YEAR}
      clientName="John"
      spouseName="Jane"
      onChange={vi.fn()}
      onResetField={vi.fn()}
    />,
  );
}

describe("Disability stressor coverage line", () => {
  it("states the coverage and the first-year benefit when a policy exists", () => {
    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.getByText(/60% to age 65/i)).toBeInTheDocument();
    expect(screen.getByText(/\$93,913/)).toBeInTheDocument();
  });

  it("says plainly when the person has no coverage", () => {
    renderTab({
      disabilityPolicies: [],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.getByText(/no disability coverage on file/i)).toBeInTheDocument();
  });

  it("reads coverage for the SELECTED person, not always the client", () => {
    // A spouse-only policy must not be reported as the client's coverage.
    renderTab({
      disabilityPolicies: [{ ...workplace, insured: "spouse" }],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.getByText(/no disability coverage on file/i)).toBeInTheDocument();
    expect(screen.queryByText(/60% to age 65/i)).not.toBeInTheDocument();
  });

  it("says why a policy on a person with no salary pays nothing", () => {
    // Reachable, not theoretical: in salary mode `resolveCoveredEarnings`
    // returns 0 whenever the insured has no salary row in the disability year —
    // a non-earning spouse, or a disability set after the paycheck ends. The
    // coverage summary is built from the CONTRACT, so without this note the row
    // reads as real cover beside a $0 benefit.
    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
      incomes: [],
    });
    expect(screen.getByText(/\$0/)).toBeInTheDocument();
    expect(screen.getByText(/no covered earnings on file/i)).toBeInTheDocument();
  });

  it("never renders a blank line for a policy carrying neither layer", () => {
    // The create/update schema rejects `hasShortTerm: false` AND
    // `hasLongTerm: false`, so this is a guard against a row that reached the
    // tree some other way. Without it `coverageSummary` joins an empty list and
    // renders an empty paragraph, which reads as coverage.
    renderTab({
      disabilityPolicies: [{ ...workplace, shortTerm: null, longTerm: null }],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.getByText(/no short-term or long-term coverage set/i)).toBeInTheDocument();
  });

  it("says long-term pays nothing when the insured spouse has no date of birth", () => {
    // The benefit period ends at an age, so it cannot resolve without a DOB.
    // `resolveCoverage` leaves `longTerm` null and flags `missing_dob`; the
    // contract still says "to age 65", so claiming that unqualified would be a
    // false statement about what the plan pays.
    renderTab({
      disabilityPolicies: [{ ...workplace, insured: "spouse" }],
      disabilityEvent: { person: "spouse", startYear: DISABILITY_YEAR },
      spouseDob: undefined,
    });
    expect(screen.getByText(/no date of birth on file/i)).toBeInTheDocument();
  });
});
