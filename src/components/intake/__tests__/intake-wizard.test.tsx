// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
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
});
