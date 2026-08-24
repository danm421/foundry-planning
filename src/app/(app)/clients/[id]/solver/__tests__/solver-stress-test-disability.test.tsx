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
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** The spouse earns too. Only the DOB test needs this: without it the insured
 *  spouse has neither a date of birth NOR covered earnings, and the assertion
 *  below would pin the PRECEDENCE between the two notes rather than the DOB
 *  note itself. */
const spouseSalary: Income = {
  id: "inc-salary-spouse",
  type: "salary",
  name: "Jane Salary",
  annualAmount: 120_000,
  startYear: 2026,
  endYear: 2035,
  growthRate: 0.03,
  owner: "spouse",
};

function tree(over: {
  disabilityPolicies?: DisabilityPolicy[];
  disabilityEvent?: { person: "client" | "spouse"; startYear: number; endYear?: number | null };
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

function renderTab(
  over: Parameters<typeof tree>[0],
  onChange: (m: unknown) => void = vi.fn(),
) {
  const working = tree(over);
  render(
    <SolverStressTestTab
      baseClientData={tree({ spouseDob: over.spouseDob })}
      workingTree={working}
      currentYear={CURRENT_YEAR}
      clientName="John"
      spouseName="Jane"
      onChange={onChange as never}
      onResetField={vi.fn()}
    />,
  );
}

/** Same tab, but wired to state the way the solver page wires it: whatever the
 *  lever commits comes straight back as the working tree. Only the tests about
 *  what the FIELDS SHOW after a commit need this — `renderTab` freezes the
 *  event, so a stale input would look correct there. */
function renderStatefulTab(over: Parameters<typeof tree>[0]) {
  function Harness() {
    const [event, setEvent] = useState(over.disabilityEvent);
    return (
      <SolverStressTestTab
        baseClientData={tree({ spouseDob: over.spouseDob })}
        workingTree={tree({ ...over, disabilityEvent: event })}
        currentYear={CURRENT_YEAR}
        clientName="John"
        spouseName="Jane"
        onChange={
          ((m: { person: "client" | "spouse"; startYear: number; endYear: number | null }) =>
            setEvent({ person: m.person, startYear: m.startYear, endYear: m.endYear })) as never
        }
        onResetField={vi.fn()}
      />
    );
  }
  render(<Harness />);
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

  it("adds the total paid through recovery when the disability ends", () => {
    // 2028 + 2029 of the engine's own figures: 93,912.52 + 95,481.00 =
    // 189,393.52. Nothing here re-derives the benefit.
    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2029 },
    });
    expect(screen.getByText(/\$93,913/)).toBeInTheDocument();
    expect(screen.getByText(/\$189,394/)).toBeInTheDocument();
    expect(screen.getByText(/through 2029/)).toBeInTheDocument();
  });

  it("shows no total for a disability that never ends", () => {
    // A "total" over an open-ended disability would be a number about the plan's
    // horizon, not about the coverage.
    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.queryByText(/through 20/)).not.toBeInTheDocument();
  });

  it("prefills the ending year from the event and leaves it blank when open-ended", () => {
    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
    });
    expect(screen.getByLabelText(/ending year/i)).toHaveValue(2033);
    cleanup();

    renderTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
    });
    expect(screen.getByLabelText(/ending year/i)).toHaveValue(null);
  });

  it("clearing the ending year commits null, not year zero", () => {
    // `Number("")` is 0, so a plain year input would silently commit a
    // disability ending in the year 0 — which reads to the engine as a
    // disability that ended before it began.
    const onChange = vi.fn();
    renderTab(
      {
        disabilityPolicies: [workplace],
        disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
      },
      onChange,
    );
    const field = screen.getByLabelText(/ending year/i);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-disability",
      person: "client",
      startYear: DISABILITY_YEAR,
      endYear: null,
    });
  });

  it("never lets the disability end before it begins", () => {
    // An inverted window suspends no year at all, so the whole stressor would
    // silently do nothing while the readout still claimed a benefit.
    const onChange = vi.fn();
    renderTab(
      {
        disabilityPolicies: [workplace],
        disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
      },
      onChange,
    );
    const end = screen.getByLabelText(/ending year/i);
    fireEvent.change(end, { target: { value: "2020" } });
    fireEvent.blur(end);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ startYear: DISABILITY_YEAR, endYear: DISABILITY_YEAR }),
    );

    // ...and moving the START past the end drags the end along.
    const start = screen.getByLabelText(/starting year/i);
    fireEvent.change(start, { target: { value: "2040" } });
    fireEvent.blur(start);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ startYear: 2040, endYear: 2040 }),
    );
  });

  it("shows the year it clamped to, not the one the advisor typed", () => {
    // Both year inputs are uncontrolled, so a value the component rewrites on
    // the advisor's behalf has to remount the field. Otherwise the box keeps
    // reading 2020 while the plan runs a disability ending in 2028 — and the
    // readout beside it says "through 2028", contradicting the field above it.
    renderStatefulTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
    });
    const end = screen.getByLabelText(/ending year/i);
    fireEvent.change(end, { target: { value: "2020" } });
    fireEvent.blur(end);
    expect(screen.getByLabelText(/ending year/i)).toHaveValue(DISABILITY_YEAR);
  });

  it("shows the ending year a later starting year dragged along", () => {
    renderStatefulTab({
      disabilityPolicies: [workplace],
      disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
    });
    const start = screen.getByLabelText(/starting year/i);
    fireEvent.change(start, { target: { value: "2040" } });
    fireEvent.blur(start);
    expect(screen.getByLabelText(/ending year/i)).toHaveValue(2040);
  });

  it("keeps the other two fields when only one of the three is edited", () => {
    // Each handler spreads the whole lever, so moving the start year cannot drop
    // the ending year the advisor just set.
    const onChange = vi.fn();
    renderTab(
      {
        disabilityPolicies: [workplace],
        disabilityEvent: { person: "client", startYear: DISABILITY_YEAR, endYear: 2033 },
      },
      onChange,
    );
    const start = screen.getByLabelText(/starting year/i);
    fireEvent.change(start, { target: { value: "2030" } });
    fireEvent.blur(start);
    expect(onChange).toHaveBeenCalledWith({
      kind: "stress-disability",
      person: "client",
      startYear: 2030,
      endYear: 2033,
    });
  });

  it("says long-term pays nothing when the insured spouse has no date of birth", () => {
    // The benefit period ends at an age, so it cannot resolve without a DOB.
    // `resolveCoverage` leaves `longTerm` null and flags `missing_dob`; the
    // contract still says "to age 65", so claiming that unqualified would be a
    // false statement about what the plan pays.
    //
    // The spouse is given a salary row ON PURPOSE. `coverageNote` reports zero
    // covered earnings FIRST — it stops both layers where a missing DOB stops
    // only the long-term one — so a spouse with neither would make this test
    // pin the precedence instead of the note it names.
    renderTab({
      disabilityPolicies: [{ ...workplace, insured: "spouse" }],
      disabilityEvent: { person: "spouse", startYear: DISABILITY_YEAR },
      incomes: [clientSalary, spouseSalary],
      spouseDob: undefined,
    });
    expect(screen.getByText(/no date of birth on file/i)).toBeInTheDocument();
    // Says what it means: only the DOB condition qualifies here.
    expect(screen.queryByText(/no covered earnings/i)).not.toBeInTheDocument();
  });
});
