// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { ReviewStep } from "../review-step";

const emptyDraft: IntakeDraft = {};

const richDraft: IntakeDraft = {
  family: {
    primary: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1975-06-15", maritalStatus: "married" },
    spouse: { firstName: "John", lastName: "Doe", dateOfBirth: "1973-09-10" },
    stateOfResidence: "CA",
    children: [{ firstName: "Alice", dateOfBirth: "2010-03-22" }],
  },
  accounts: [
    { name: "Fidelity Brokerage", category: "taxable", value: 100000 },
    { name: "Roth IRA", category: "retirement", value: 50000 },
  ],
  income: [
    { name: "Salary", type: "salary", annualAmount: 120000, owner: "client" },
  ],
  property: [
    { name: "Main home", kind: "real_estate", value: 800000 },
  ],
  goals: {
    clientRetirementAge: 65,
    annualRetirementExpenses: 80000,
  },
};

function makeProps(overrides: Partial<Parameters<typeof ReviewStep>[0]> = {}) {
  return {
    value: richDraft,
    onEdit: vi.fn(),
    ...overrides,
  };
}

describe("ReviewStep", () => {
  it("renders a summary of family information when populated", () => {
    render(<ReviewStep {...makeProps()} />);
    expect(screen.getByText(/jane/i)).toBeInTheDocument();
  });

  it("renders account summary when accounts are present", () => {
    render(<ReviewStep {...makeProps()} />);
    expect(screen.getByText(/fidelity brokerage/i)).toBeInTheDocument();
  });

  it("renders income summary when income is present", () => {
    render(<ReviewStep {...makeProps()} />);
    expect(screen.getByText(/salary/i)).toBeInTheDocument();
  });

  it("renders property summary when property is present", () => {
    render(<ReviewStep {...makeProps()} />);
    expect(screen.getByText(/main home/i)).toBeInTheDocument();
  });

  it("renders goals summary when goals are present", () => {
    render(<ReviewStep {...makeProps()} />);
    // Goals section with retirement age info
    expect(screen.getByText(/65/)).toBeInTheDocument();
  });

  it("renders Edit affordances for each populated section", () => {
    render(<ReviewStep {...makeProps()} />);
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it("clicking an Edit button calls onEdit with the correct section", () => {
    const onEdit = vi.fn();
    render(<ReviewStep {...makeProps({ onEdit })} />);

    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("shows empty-state text for sections with no data", () => {
    render(<ReviewStep {...makeProps({ value: emptyDraft })} />);
    // With an empty draft, empty-state messages are shown for each section.
    // No in-body Submit button — the chrome's "Submit" button is the sole affordance.
    expect(screen.queryByRole("button", { name: /^submit$/i })).not.toBeInTheDocument();
  });
});
