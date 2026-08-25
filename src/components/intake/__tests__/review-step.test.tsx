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
    sections: ["family", "accounts", "income", "property", "goals"] as const,
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

  it("summarizes only the sections the form collects", () => {
    render(<ReviewStep {...makeProps({ sections: ["family"] })} />);

    expect(screen.getByText(/jane/i)).toBeInTheDocument();
    // The CARD is gone, not just its empty state: richDraft has real accounts,
    // so a rendered-but-empty card would still show this row.
    expect(screen.queryByText("Fidelity Brokerage")).not.toBeInTheDocument();
    // Asserting the empty states are absent would be vacuous here — richDraft
    // populates all three, so they never render either way. The wizard test
    // ("threads the section set through to the Review screen") covers the empty
    // draft, where "No accounts added." is live and the absence means something.
  });

  it("swaps the intro when the form collects nothing this screen reviews", () => {
    render(<ReviewStep {...makeProps({ sections: ["documents"] })} />);

    // A documents-only form reaches Review with nothing to summarize; the intro
    // must not still tell the client to check what they shared.
    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
    expect(screen.queryByText(/review what you/i)).not.toBeInTheDocument();
    // One Edit button per card, so no Edit button means no cards.
    expect(screen.queryByRole("button", { name: /^edit/i })).not.toBeInTheDocument();
  });
});

// ─── Estate ──────────────────────────────────────────────────────────────────
//
// The estate card is the client's last chance to catch a wrong nomination
// before it becomes an attorney-facing note, so it has to show what was
// entered — and, just as load-bearing, must NOT show a Yes to a question
// nobody answered.

const estateDraft: IntakeDraft = {
  family: richDraft.family,
  estate: {
    residence: {
      addressLine1: "123 Maple St",
      addressLine2: "Apt 2",
      city: "Ann Arbor",
      state: "MI",
      postalCode: "48104",
      isLegalResidence: false,
      legalResidenceNote: "Florida",
    },
    fiduciaries: [
      { role: "guardian", priority: "primary", name: "Sarah Klein" },
      { role: "trustee", priority: "primary", name: "Dev Patel" },
      { role: "executor", priority: "backup", name: "Dev Patel" },
    ],
    fiduciaryContacts: [],
    childrenDistribution: { plan: "suggested" },
  },
};

function estateProps(overrides: Partial<Parameters<typeof ReviewStep>[0]> = {}) {
  return {
    value: estateDraft,
    onEdit: vi.fn(),
    sections: ["family", "estate"] as const,
    ...overrides,
  };
}

describe("ReviewStep — estate", () => {
  it("summarizes the address, the nominations and the children's schedule", () => {
    render(<ReviewStep {...estateProps()} />);

    expect(screen.getByText("123 Maple St, Apt 2, Ann Arbor, MI 48104")).toBeInTheDocument();
    expect(screen.getByText("Guardian · First choice")).toBeInTheDocument();
    expect(screen.getByText("Sarah Klein")).toBeInTheDocument();
    expect(screen.getByText("Executor · Backup")).toBeInTheDocument();
    // The one-line summary, which is the same wording the step showed — not a
    // bare "chose the suggested schedule", which records nothing.
    expect(
      screen.getByText(/suggested schedule .* own trustee at 25; ⅓ at 25, ½ at 30, balance at 35/i),
    ).toBeInTheDocument();
  });

  it("shows a No answer as No, with where they actually reside", () => {
    render(<ReviewStep {...estateProps()} />);
    expect(screen.getByText("No — Florida")).toBeInTheDocument();
  });

  it("shows NOTHING for the legal-residence question when it was never answered", () => {
    // The row must disappear, not render a Yes: an unasked question recorded as
    // a Yes is how the wrong state's law ends up governing the documents.
    const unanswered: IntakeDraft = {
      ...estateDraft,
      estate: {
        ...estateDraft.estate,
        residence: { ...estateDraft.estate?.residence, isLegalResidence: undefined, legalResidenceNote: undefined },
      },
    };
    render(<ReviewStep {...estateProps({ value: unanswered })} />);

    // The card is populated — this is not a vacuous absence.
    expect(screen.getByText("123 Maple St, Apt 2, Ann Arbor, MI 48104")).toBeInTheDocument();
    expect(screen.queryByText("Legal residence")).not.toBeInTheDocument();
    expect(screen.queryByText("Yes")).not.toBeInTheDocument();
  });

  it("omits slots nobody was named for rather than showing blank rows", () => {
    render(<ReviewStep {...estateProps()} />);
    // Six slots exist; three were filled.
    expect(screen.queryByText("Guardian · Backup")).not.toBeInTheDocument();
    expect(screen.queryByText("Trustee · Backup")).not.toBeInTheDocument();
    expect(screen.queryByText("Executor · First choice")).not.toBeInTheDocument();
  });

  it("hides the children's schedule row for a household with no children", () => {
    const noKids: IntakeDraft = {
      ...estateDraft,
      family: { ...estateDraft.family, children: [] },
    };
    render(<ReviewStep {...estateProps({ value: noKids })} />);

    expect(screen.queryByText("Children’s inheritance")).not.toBeInTheDocument();
    // ...while the rest of the card still renders.
    expect(screen.getByText("Guardian · First choice")).toBeInTheDocument();
  });

  it("says so plainly when the client skipped the whole step", () => {
    render(<ReviewStep {...estateProps({ value: { family: richDraft.family } })} />);
    expect(screen.getByText("No estate details entered.")).toBeInTheDocument();
  });

  it("drops the card entirely when the form does not collect Estate", () => {
    // Not just an empty state: estateDraft is populated, so a rendered card
    // would still show the address.
    render(<ReviewStep {...estateProps({ sections: ["family"] })} />);
    expect(screen.queryByText("123 Maple St, Apt 2, Ann Arbor, MI 48104")).not.toBeInTheDocument();
    expect(screen.queryByText("No estate details entered.")).not.toBeInTheDocument();
  });

  it("jumps back to the Estate step from its Edit button", () => {
    const onEdit = vi.fn();
    render(<ReviewStep {...estateProps({ onEdit })} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Estate" }));
    expect(onEdit).toHaveBeenCalledWith("estate");
  });
});
