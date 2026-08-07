// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { IntakeWizard } from "../intake-wizard";
import { RTQ_V1 } from "@/lib/risk/rtq";

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
  it("shows the Welcome screen with the default section set and a Start Here control on initial render", () => {
    render(<IntakeWizard {...makeProps()} />);

    // Welcome heading present
    expect(screen.getByRole("heading", { name: /welcome/i })).toBeInTheDocument();

    // Named by card, not counted — a count assertion rots the moment a
    // section is added. Default set, rendered with no upload surface (these
    // props are the portal's): Family, Assets, Goals, Review. Documents is in
    // the default set but has no step here, so it gets no card either.
    expect(screen.getByText(/family/i)).toBeInTheDocument();
    expect(screen.getByText(/assets/i)).toBeInTheDocument();
    expect(screen.getByText(/goals/i)).toBeInTheDocument();
    expect(screen.queryByText(/^documents$/i)).not.toBeInTheDocument();
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
// The wizard has three upload cases, and each host picks exactly one:
//
//   live     the public /intake/[token] form — token + documents + onChanged.
//   sample   the advisor's preview — `sampleUploads`, an inert visual sample.
//   none     the portal wizard — no upload props at all, no affordance anywhere.
//
// Everything above renders the wizard with no upload props, so those tests
// double as the `none` case (6 chrome steps, no Documents step). The preview is
// NOT that case any more: it takes `sampleUploads` and gets 7.

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

    // The portal wizard's configuration — no upload props, and no `sampleUploads`
    // either — keeps its six steps.
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

// ─── Sample uploads (the advisor's preview) ──────────────────────────────────
//
// `sampleUploads` is the third case: the upload UI renders with its real layout
// and copy, and nothing is wired to it. The preview page makes no request at
// all, so these tests police the absence of every mechanism that could make one.

/** Walk from the Family step to Documents. The wizard must already be started. */
function advanceFromFamilyToDocuments() {
  fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Family
  fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Accounts
  fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // Income
  fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // Property
  fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Goals
}

describe("IntakeWizard sample uploads", () => {
  it("adds the Documents step, exactly as the live form has it", () => {
    render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);
    startWizard();

    expect(
      screen.getAllByText((_, el) => {
        if (el?.tagName !== "SPAN") return false;
        return /step\s+1\s*\/\s*7/i.test(el.textContent ?? "");
      }).length,
    ).toBeGreaterThan(0);

    advanceFromFamilyToDocuments();
    expect(screen.getByRole("heading", { name: /^documents$/i })).toBeInTheDocument();
    expect(screen.getByText("Add a document")).toBeInTheDocument();
  });

  it("shows the contextual zone on Accounts, Income and Property", () => {
    render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts
    expect(screen.getByText("Or upload your statements")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Income
    expect(screen.getByText("Or upload a pay stub or W-2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // → Property
    expect(
      screen.getByText("Upload a mortgage statement or property tax bill"),
    ).toBeInTheDocument();
  });

  it("renders no file input, and a drop target that is not a button", () => {
    const { container } = render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);

    const zones: [label: string, advance: RegExp][] = [
      ["Or upload your statements", /^next$/i],
      ["Or upload a pay stub or W-2", /skip for now/i],
      ["Upload a mortgage statement or property tax bill", /skip for now/i],
    ];

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts
    for (const [label, advance] of zones) {
      // The live zone wraps this copy in a <button> that opens a file picker.
      // The sample's is a <div>, so there is nothing to click and no input to
      // open — the two mechanisms that could reach the upload route.
      expect(screen.getByText(label).closest("button")).toBeNull();
      expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: advance }));
    }

    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Goals → Documents
    expect(screen.getByText("Add a document").closest("button")).toBeNull();
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("shows a sample file row whose Remove button is inert", () => {
    render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);
    startWizard();
    advanceFromFamilyToDocuments();

    const row = screen.getByText("example-tax-return.pdf").closest("li");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("Tax return");

    // The control renders — the advisor should see it — but cannot fire.
    expect(
      screen.getByRole("button", { name: "Remove example-tax-return.pdf" }),
    ).toBeDisabled();
  });

  it("offers no way to retrieve the sample document", () => {
    const { container } = render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);
    startWizard();
    advanceFromFamilyToDocuments();

    // Same property the live zone holds: there is no client-facing download
    // route, so a row must never carry a link or a locator.
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("blob.vercel-storage.com");
  });

  it("leaves every Skip label reading as it does for a client with nothing uploaded", () => {
    render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Income

    // A live paystub would flip Income to "Next" (see the live suite above); the
    // sample's rows are invisible to that logic, so the preview keeps showing
    // the copy a fresh client actually gets.
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // → Property
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i })); // → Goals
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Documents

    // ...including on Documents itself, where a live document would mean "Next".
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("keeps the live zone when a host passes both — a real token always wins", () => {
    const { container } = render(
      <IntakeWizard {...makeProps({ ...uploadProps([]), sampleUploads: true })} />,
    );

    startWizard();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // → Accounts

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  });
});

describe("IntakeWizard — section set", () => {
  it("renders only the selected steps in canonical order", () => {
    render(<IntakeWizard {...makeProps({ sections: ["family", "documents"], sampleUploads: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));

    // Family first, then Documents, then Review — no Accounts/Income/Property.
    expect(screen.getByRole("heading", { name: /^family$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next|skip for now/i }));
    expect(screen.getByRole("heading", { name: /^documents$/i })).toBeInTheDocument();
  });

  it("suppresses the Documents step when there is no upload surface, even if selected", () => {
    // The portal wizard has no token and no sample: a step whose only content is
    // an upload zone it cannot use must not appear.
    render(<IntakeWizard {...makeProps({ sections: ["family", "documents"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /next|skip for now/i }));
    expect(screen.getByRole("heading", { name: /review/i })).toBeInTheDocument();
  });

  // Risk is the one section whose progress-bar chip and H1 differ. Both halves
  // are pinned: the chip is compact because the bar lays every label out on one
  // row, and the welcome card takes the full label because a card is not width
  // constrained the same way.
  it("names the Risk card by its full label on the Welcome screen", () => {
    render(<IntakeWizard {...makeProps({ sections: ["family", "risk"] })} />);
    expect(screen.getByText("Risk tolerance")).toBeInTheDocument();
  });

  it("keeps the Risk chip compact while its heading reads in full", () => {
    render(<IntakeWizard {...makeProps({ sections: ["family", "risk"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Family → Risk

    expect(screen.getByRole("heading", { name: /^risk tolerance$/i })).toBeInTheDocument();
    // Anchored: "Step 2 / 3 · Risk tolerance" must not satisfy this.
    expect(
      screen.getAllByText((_, el) => {
        if (el?.tagName !== "SPAN") return false;
        return /step\s+2\s*\/\s*3\s*·\s*risk$/i.test((el.textContent ?? "").trim());
      }).length,
    ).toBeGreaterThan(0);
  });

  it("defaults to the full default set when no sections prop is given", () => {
    render(<IntakeWizard {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /next|skip for now/i }));
    expect(screen.getByRole("heading", { name: /^accounts$/i })).toBeInTheDocument();
  });

  it("offers no Documents card on Welcome without an upload surface", () => {
    // The portal wizard's configuration. The overview must not promise a step
    // the wizard then silently skips.
    render(<IntakeWizard {...makeProps()} />);
    expect(screen.queryByText(/^documents$/i)).not.toBeInTheDocument();
  });

  it("shows the Documents card on Welcome where uploads are offered", () => {
    render(<IntakeWizard {...makeProps({ sampleUploads: true })} />);
    expect(screen.getByText(/^documents$/i)).toBeInTheDocument();
  });

  it("renders the RTQ on the Risk step and lifts an answer into the draft", () => {
    const onChange = vi.fn();
    render(<IntakeWizard {...makeProps({ sections: ["risk"], onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));

    const first = RTQ_V1[0];
    expect(screen.getByText(first.prompt)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(first.options[0].label));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        risk: expect.objectContaining({ answers: { [first.id]: first.options[0].value } }),
      }),
    );
  });

  it("offers Skip on an unanswered Risk step and plain Next once answered", () => {
    const first = RTQ_V1[0];
    const { unmount } = render(<IntakeWizard {...makeProps({ sections: ["risk"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
    unmount();

    render(
      <IntakeWizard
        {...makeProps({
          sections: ["risk"],
          value: { risk: { answers: { [first.id]: first.options[0].value } } },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    expect(screen.queryByRole("button", { name: /skip for now/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  });

  it("threads the section set through to the Review screen", () => {
    render(<IntakeWizard {...makeProps({ sections: ["family"] })} />);

    fireEvent.click(screen.getByRole("button", { name: /start here/i }));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i })); // Family → Review

    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
    expect(screen.queryByText(/no accounts added/i)).not.toBeInTheDocument();
  });
});
