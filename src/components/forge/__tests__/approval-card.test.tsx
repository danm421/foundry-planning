// @vitest-environment jsdom
// src/components/forge/__tests__/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard } from "../approval-card";

const previews = [
  { summary: "Add Roth conversion: $40,000 in 2026", name: "propose_changes", details: ["Roth conversion · 2026 · gross $40,000", "Moves end-of-plan portfolio by +$214k"] },
  { summary: `Remove brokerage account “Joint Taxable”`, name: "propose_changes", details: ["Cascade: a $2,000/mo transfer into this account will be dropped"] },
];
const calls = [
  { id: "call_a", name: "propose_changes", args: {} },
  { id: "call_b", name: "propose_changes", args: {} },
];

describe("ApprovalCard", () => {
  it("renders every preview summary and its detail lines", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Add Roth conversion: $40,000 in 2026")).toBeTruthy();
    expect(screen.getByText("Moves end-of-plan portfolio by +$214k")).toBeTruthy();
    expect(screen.getByText(/Cascade: a \$2,000\/mo transfer/)).toBeTruthy();
  });
  it("renders a read-only receipt when resolved (no live buttons)", () => {
    render(
      <ApprovalCard
        previews={previews}
        calls={calls}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        resolved={[
          { id: "call_a", choice: "confirm" },
          { id: "call_b", choice: "reject" },
        ]}
      />,
    );
    // No interactive controls in receipt mode.
    expect(screen.queryByRole("button")).toBeNull();
    // Per-call settled badges (exact, to distinguish from the header summary).
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
    // Still shows the change summaries.
    expect(screen.getByText("Add Roth conversion: $40,000 in 2026")).toBeInTheDocument();
  });

  it("builds the decisions map from per-row choices on submit", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm row 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "confirm", call_b: "reject" });
  });
  it("confirm-all sets every row to confirm", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm all/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "confirm", call_b: "confirm" });
  });
  it("reject-all clears every row, leaving nothing to apply", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm row 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    // Reject-all is a row-state helper, not a submit. With 0 confirmed there is
    // nothing to apply, so the primary is unavailable and "Decline all" is the
    // way to send an all-reject verdict.
    expect(screen.getByRole("button", { name: /apply selected/i }).hasAttribute("disabled")).toBe(true);
  });
  it("disables actions while busy", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /apply selected/i }).hasAttribute("disabled")).toBe(true);
  });
});

// ─── Regression: the card must never turn an affirmative click into a decline ──
//
// SHIPPED BUG (pre-existing, reproduced live against a real build_plan proposal
// that silently declined and created nothing): every row defaults to "reject"
// (fail-safe, and correct), but that default was paired with an accent-filled
// primary CTA — `Apply selected (0)` — that stayed ENABLED at zero confirmed.
// Clicking the most affirmative-looking control in the card without first
// finding the small per-row "Confirm" pill SUBMITTED A DECLINE. The only signal
// that anything was wrong was a digit inside the button label.
//
// Every pre-existing test walked an explicit path (confirm-a-row-then-apply,
// reject-all) and so never touched the click-the-primary-first path a real
// advisor takes. These lock it down from both ends: the primary can no longer
// submit a decline, and the common single-change card no longer has a decoy
// primary at all.
describe("ApprovalCard — affirmative controls never submit a decline", () => {
  const onePreview = [previews[0]];
  const oneCall = [calls[0]];

  it("single change: the primary approves — it does not decline", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={onePreview} calls={oneCall} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    // No hunting for a pill first — this is the whole interaction.
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "confirm" });
  });

  it("single change: reject submits a decline", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={onePreview} calls={oneCall} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "reject" });
  });

  it("single change: collapses to exactly two controls", () => {
    render(<ApprovalCard previews={onePreview} calls={oneCall} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Six controls (Confirm, Reject, Confirm all, Reject all, Cancel, Apply
    // selected) for one yes/no decision is what made the decoy primary possible.
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Reject", "Approve"]);
  });

  it("single change: still shows the summary and detail lines", () => {
    render(<ApprovalCard previews={onePreview} calls={oneCall} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Add Roth conversion: $40,000 in 2026")).toBeInTheDocument();
    expect(screen.getByText("Moves end-of-plan portfolio by +$214k")).toBeInTheDocument();
  });

  it("multi change: the primary is disabled until a row is confirmed", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const apply = screen.getByRole("button", { name: /apply selected/i });
    // THE BUG: this used to be enabled at (0) and submit two rejects.
    expect(apply.hasAttribute("disabled")).toBe(true);
    fireEvent.click(apply);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm row 1/i }));
    expect(screen.getByRole("button", { name: /apply selected/i }).hasAttribute("disabled")).toBe(false);
  });

  it("multi change: declining everything is an explicit, labelled action", () => {
    const onCancel = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={vi.fn()} onCancel={onCancel} />);
    // The decline path was previously labelled "Cancel", which reads as
    // "dismiss without deciding" — but it resumed the graph with all-reject.
    fireEvent.click(screen.getByRole("button", { name: /decline all/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
