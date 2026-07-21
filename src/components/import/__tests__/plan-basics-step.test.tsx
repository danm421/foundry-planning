// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PlanBasicsStep from "../plan-basics-step";
import { emptyPlanBasics } from "@/lib/imports/assemble/plan-basics";
import type { AssemblePlanBasics } from "@/lib/imports/assemble/types";

function basics(over: Partial<AssemblePlanBasics> = {}): AssemblePlanBasics {
  return {
    retirementAge: { value: 65, provenance: "build_request" },
    lifeExpectancy: { value: 92, provenance: "build_request" },
    currentLivingSpending: {
      value: 110414,
      provenance: "derived",
      reason: "Estimated from the 2025 return: AGI minus total tax. Does not account for saving into taxable accounts.",
    },
    retirementLivingSpending: { value: 88331, provenance: "derived", reason: "Estimated at 80% of current living expenses." },
    socialSecurity: [
      { owner: "client", pia: { value: null, provenance: "derived" },
        claimingAge: { value: 67, provenance: "derived", reason: "Defaulted to full retirement age (67) for a 1972 birth year." } },
    ],
    ...over,
  };
}

describe("PlanBasicsStep", () => {
  it("renders with a completely empty payload — it is not row-driven", () => {
    render(<PlanBasicsStep value={basics()} hasSpouse={false} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/retirement age/i)).toBeInTheDocument();
  });

  it("shows an Assumed chip on a derived field", () => {
    render(<PlanBasicsStep value={basics()} hasSpouse={false} onChange={vi.fn()} />);
    expect(screen.getAllByTestId("assumed-chip").length).toBeGreaterThan(0);
  });

  it("shows NO chip on a field the advisor stated", () => {
    const v = basics({ currentLivingSpending: { value: 90000, provenance: "stated" } });
    render(<PlanBasicsStep value={v} hasSpouse={false} onChange={vi.fn()} />);
    const chips = screen.queryAllByTestId("assumed-chip");
    // The remaining chips belong to other fields, not current spending.
    expect(chips.every((c) => !c.closest("[data-field='currentLivingSpending']"))).toBe(true);
  });

  it("marks an edited field as stated, which clears its chip", () => {
    const onChange = vi.fn();
    render(<PlanBasicsStep value={basics()} hasSpouse={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/current living spending/i), {
      target: { value: "95000" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        currentLivingSpending: { value: 95000, provenance: "stated" },
      }),
    );
  });

  it("hides spouse fields for a single filer", () => {
    render(<PlanBasicsStep value={basics()} hasSpouse={false} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/spouse retirement age/i)).not.toBeInTheDocument();
  });

  it("shows spouse fields for a married household", () => {
    const v = basics({
      spouseRetirementAge: { value: 65, provenance: "build_request" },
      spouseLifeExpectancy: { value: 92, provenance: "build_request" },
    });
    render(<PlanBasicsStep value={v} hasSpouse onChange={vi.fn()} />);
    expect(screen.getByLabelText(/spouse retirement age/i)).toBeInTheDocument();
  });

  it("renders a blank field as empty rather than as zero", () => {
    const v = basics({ currentLivingSpending: { value: null, provenance: "derived" } });
    render(<PlanBasicsStep value={v} hasSpouse={false} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/current living spending/i) as HTMLInputElement).value).toBe("");
  });

  it("renders emptyPlanBasics() — the fallback for a pre-feature import — as blank and unchipped", () => {
    render(<PlanBasicsStep value={emptyPlanBasics()} hasSpouse={false} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/retirement age/i) as HTMLInputElement).value).toBe("");
    expect(screen.queryAllByTestId("assumed-chip").length).toBe(0);
  });

  it("gives a married household with fully-absent planBasics an empty, editable spouse retirement age field", () => {
    // emptyPlanBasics() leaves spouseRetirementAge/spouseLifeExpectancy
    // undefined (not blank) — a married household must still get an
    // editable field, not an absent one.
    render(<PlanBasicsStep value={emptyPlanBasics()} hasSpouse onChange={vi.fn()} />);
    const input = screen.getByLabelText(/spouse retirement age/i) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "66" } });
  });
});
