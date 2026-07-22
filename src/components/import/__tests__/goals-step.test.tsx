// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GoalsStep from "../goals-step";
import { emptyGoals } from "@/lib/imports/assemble/goals";
import type { EducationGoal } from "@/lib/imports/assemble/types";

/**
 * Spreads over a complete EducationGoal so each test overrides only the
 * field it asserts on. Defaults are deliberately NOT "derived" (except where
 * a test overrides one) — a fixture that defaulted to derived-with-reason
 * everywhere would make "shows no chip on a stated field" fail on chips it
 * never meant to test.
 */
function educationGoalFixture(over: Partial<EducationGoal> = {}): EducationGoal {
  return {
    id: "edu:emma",
    name: { value: "Emma — College", provenance: "document" },
    forFamilyMemberName: { value: "Emma", provenance: "document" },
    annualAmount: { value: 45000, provenance: "stated" },
    startYear: { value: 2028, provenance: "stated" },
    years: { value: 4, provenance: "stated" },
    growthRate: { value: 0.05, provenance: "stated" },
    payShortfallOutOfPocket: { value: false, provenance: "stated" },
    dedicatedAccountNames: [],
    ...over,
  };
}

const baseProps = {
  accountOptions: [{ id: "a1", name: "Emma 529 Plan" }],
  dependentOptions: ["Emma"],
  currentYear: 2026,
  onChange: vi.fn(),
};

describe("GoalsStep", () => {
  it("renders on an import with no goals at all", () => {
    render(<GoalsStep value={emptyGoals()} {...baseProps} />);
    expect(screen.getByRole("button", { name: /add education goal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add planned purchase/i })).toBeInTheDocument();
  });

  it("shows an Assumed chip on a derived field and its reason", () => {
    const value = {
      ...emptyGoals(),
      education: [
        educationGoalFixture({
          startYear: {
            value: 2028,
            provenance: "derived",
            reason: "First year of college at age 18, from Emma's 2010 birth year.",
          },
        }),
      ],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.getByText(/first year of college at age 18/i)).toBeInTheDocument();
  });

  it("shows no chip on a stated field", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: 45000, provenance: "stated" } })],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.queryByText(/assumed/i)).not.toBeInTheDocument();
  });

  it("flags a goal whose annual cost is blank as not-yet-committable", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: null, provenance: "derived" } })],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.getByText(/add an annual cost/i)).toBeInTheDocument();
  });

  it("marks an edited field as stated", () => {
    const onChange = vi.fn();
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: null, provenance: "derived" } })],
    };
    render(<GoalsStep value={value} {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/annual cost/i), { target: { value: "45000" } });
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.education[0].annualAmount).toEqual({ value: 45000, provenance: "stated" });
  });

  it("adds and removes a planned purchase", () => {
    const onChange = vi.fn();
    render(<GoalsStep value={emptyGoals()} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add planned purchase/i }));
    expect(onChange.mock.calls.at(-1)![0].homePurchases).toHaveLength(1);
  });

  it("adds an education goal", () => {
    const onChange = vi.fn();
    render(<GoalsStep value={emptyGoals()} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add education goal/i }));
    expect(onChange.mock.calls.at(-1)![0].education).toHaveLength(1);
  });

  it("removes an education goal", () => {
    const onChange = vi.fn();
    const value = { ...emptyGoals(), education: [educationGoalFixture()] };
    render(<GoalsStep value={value} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange.mock.calls.at(-1)![0].education).toHaveLength(0);
  });
});
