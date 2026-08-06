// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { IntakeWizard } from "../intake-wizard";

const emptyDraft: IntakeDraft = {};

function makeProps(overrides: Partial<Parameters<typeof IntakeWizard>[0]> = {}) {
  return {
    value: emptyDraft,
    onChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    mode: "blank" as const,
    busy: false,
    error: null,
    ...overrides,
  };
}

describe("IntakeWizard", () => {
  it("shows the Welcome screen with four sections and a Start Here control on initial render", () => {
    render(<IntakeWizard {...makeProps()} />);

    // Welcome heading present
    expect(screen.getByRole("heading", { name: /welcome/i })).toBeInTheDocument();

    // Four section labels visible (Family, Assets, Goals, Review)
    expect(screen.getByText(/family/i)).toBeInTheDocument();
    expect(screen.getByText(/assets/i)).toBeInTheDocument();
    expect(screen.getByText(/goals/i)).toBeInTheDocument();
    expect(screen.getByText(/review/i)).toBeInTheDocument();

    // Start Here CTA
    expect(screen.getByRole("button", { name: /start here/i })).toBeInTheDocument();
  });

  it("clicking Start Here advances to the Family step", () => {
    render(<IntakeWizard {...makeProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /start here/i }));

    // Should now show the Family step placeholder
    expect(screen.getByRole("heading", { name: /family/i })).toBeInTheDocument();

    // Welcome screen CTA should be gone
    expect(screen.queryByRole("button", { name: /start here/i })).not.toBeInTheDocument();
  });

  it("progress indicator reflects section position after advancing past Welcome", () => {
    render(<IntakeWizard {...makeProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /start here/i }));

    // WizardChrome renders "Step {current+1} / {total} · {label}" in a span.tabular
    // Family is chrome step 1 of 6. The label "Family" appears in the progress span.
    // Use getAllByText with a custom matcher scoped to leaf-ish span elements.
    const progressSpans = screen
      .getAllByText((_, el) => {
        if (el?.tagName !== "SPAN") return false;
        const text = el.textContent ?? "";
        return /step\s+1\s*\/\s*6/i.test(text);
      });
    expect(progressSpans.length).toBeGreaterThan(0);
  });

  it("Back button on Family step returns to Welcome screen", () => {
    render(<IntakeWizard {...makeProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    // Now on Family — click Back
    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByRole("button", { name: /start here/i })).toBeInTheDocument();
  });

  it("renders in prefilled mode without visual difference in shell", () => {
    render(<IntakeWizard {...makeProps({ mode: "prefilled" })} />);
    expect(screen.getByRole("button", { name: /start here/i })).toBeInTheDocument();
  });

  it("shows error message when error prop is set", () => {
    render(<IntakeWizard {...makeProps({ error: "Something went wrong" })} />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("clicking the chrome Submit button on the review step calls onSubmit", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<IntakeWizard {...makeProps({ onSubmit })} />);

    // Advance through all steps: Welcome → Family → Accounts → Income → Property → Goals → Review
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    // Step 1: Family
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Step 2: Accounts
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Step 3: Income (skipable)
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    // Step 4: Property (skipable)
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    // Step 5: Goals
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Step 6: Review — chrome button is now labelled "Submit"
    const submitBtn = screen.getByRole("button", { name: /submit/i });
    expect(submitBtn).toBeInTheDocument();
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("labels the Income step Next once an income has been entered, and Property still Skip", () => {
    render(
      <IntakeWizard
        {...makeProps({
          value: {
            income: [
              { name: "Salary at Acme", type: "salary", annualAmount: 120_000, owner: "client" },
            ],
          },
        })}
      />,
    );

    // Welcome → Family → Accounts → Income
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip for now/i })).not.toBeInTheDocument();

    // Property is still empty, so it keeps the skip affordance
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("keeps Skip for now on the Income step while every row is blank", () => {
    render(
      <IntakeWizard
        {...makeProps({
          // A card the client added via "Add income" and never filled in.
          value: { income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }] },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("shows the firm logo letterhead when branding is provided, on welcome and chrome steps", () => {
    render(
      <IntakeWizard
        {...makeProps({
          branding: {
            logoUrl: "https://cdn.example/logo.png",
            firmName: "Acme Wealth",
          },
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "Acme Wealth" })).toBeInTheDocument();

    // Letterhead persists past the welcome screen onto WizardChrome steps
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    expect(screen.getByRole("img", { name: "Acme Wealth" })).toBeInTheDocument();
  });

  it("shows the Foundry lockup letterhead when unbranded", () => {
    render(<IntakeWizard {...makeProps()} />);
    expect(
      screen.getByRole("img", { name: "Foundry Planning" }),
    ).toBeInTheDocument();
  });
});

// ─── Uploads ─────────────────────────────────────────────────────────────────
//
// Everything above renders the wizard with no upload props, which is also the
// portal wizard's and the preview's configuration — so those tests double as
// the "no uploads offered" case (6 chrome steps, no Documents step).

function doc(over: Partial<IntakeDocumentView> & { id: string }): IntakeDocumentView {
  return {
    filename: "file.pdf",
    docType: "other",
    sizeBytes: 1024,
    uploadedAt: "2026-08-01T12:00:00.000Z",
    ...over,
  };
}

/** The three props that together turn uploads on. */
function uploadProps(documents: IntakeDocumentView[]) {
  return { token: "tok_abc", documents, onDocumentsChanged: vi.fn() };
}

function startWizard() {
  fireEvent.click(screen.getByRole("button", { name: /start here/i }));
}

describe("IntakeWizard uploads", () => {
  it("adds a Documents step before Review only where uploads are offered", () => {
    const { unmount } = render(<IntakeWizard {...makeProps(uploadProps([]))} />);
    startWizard();

    expect(
      screen.getAllByText((_, el) => {
        if (el?.tagName !== "SPAN") return false;
        return /step\s+1\s*\/\s*7/i.test(el.textContent ?? "");
      }).length,
    ).toBeGreaterThan(0);
    unmount();

    // Same wizard without the upload props keeps its six steps.
    render(<IntakeWizard {...makeProps()} />);
    startWizard();
    expect(
      screen.getAllByText((_, el) => {
        if (el?.tagName !== "SPAN") return false;
        return /step\s+1\s*\/\s*6/i.test(el.textContent ?? "");
      }).length,
    ).toBeGreaterThan(0);
  });

  it("reaches the Documents step between Goals and Review", () => {
    render(<IntakeWizard {...makeProps(uploadProps([]))} />);

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Family
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Accounts
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // Income
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // Property
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Goals

    expect(screen.getByRole("heading", { name: /^documents$/i })).toBeInTheDocument();
    // Nothing uploaded yet, so the step still offers to be skipped.
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("stops offering to skip a step once a document answers it", () => {
    render(
      <IntakeWizard
        {...makeProps(uploadProps([doc({ id: "d1", docType: "paystub" })]))}
      />,
    );

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Family
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Accounts

    // Income: no rows, but a pay stub is on file — that is not a skipped step.
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip for now/i })).not.toBeInTheDocument();

    // Property has neither a row nor a mortgage document, so it still skips.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("shows each contextual zone only the documents of its own type", () => {
    render(
      <IntakeWizard
        {...makeProps(
          uploadProps([
            doc({ id: "d1", docType: "statement", filename: "schwab.pdf" }),
            doc({ id: "d2", docType: "paystub", filename: "june-paystub.pdf" }),
          ]),
        )}
      />,
    );

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts

    expect(screen.getByText("schwab.pdf")).toBeInTheDocument();
    expect(screen.queryByText("june-paystub.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Income
    expect(screen.getByText("june-paystub.pdf")).toBeInTheDocument();
    expect(screen.queryByText("schwab.pdf")).not.toBeInTheDocument();
  });

  it("offers no upload affordance at all without the upload props", () => {
    render(<IntakeWizard {...makeProps()} />);

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts

    expect(screen.queryByText(/drag and drop/i)).not.toBeInTheDocument();
  });
});
