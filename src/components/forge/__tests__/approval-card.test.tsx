// @vitest-environment jsdom
// src/components/forge/__tests__/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard, batchTitle } from "../approval-card";

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

  it("renders a short 'Label: value' detail as a label and a mono value", () => {
    render(
      <ApprovalCard
        previews={[{ summary: "Add account “Schwab Brokerage”.", name: "add_account", details: ["Type: Taxable · Brokerage", "Balance: $150,000"] }]}
        calls={[calls[0]]}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("$150,000")).toHaveClass("tabular");
    // A value with no digits stays in the UI face.
    expect(screen.getByText("Taxable · Brokerage")).not.toHaveClass("tabular");
  });

  it("disables actions while busy", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve all 2/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /decline all/i }).hasAttribute("disabled")).toBe(true);
  });
});

describe("batchTitle", () => {
  it("names a homogeneous batch by what it does", () => {
    const acct = { summary: "", name: "add_account" };
    expect(batchTitle([acct, acct, acct])).toBe("Add 3 accounts");
    const liab = { summary: "", name: "add_liability" };
    expect(batchTitle([liab, liab])).toBe("Add 2 liabilities");
    const inc = { summary: "", name: "update_income" };
    expect(batchTitle([inc, inc])).toBe("Update 2 income sources");
  });
  it("falls back to a plain count for a mixed batch", () => {
    expect(batchTitle(previews)).toBe("2 changes");
  });
});

// ─── One decision, one click — and no affirmative control ever submits a decline ──
//
// The batch card used to need two steps: find and press a small per-row
// "Confirm" pill, then "Apply selected (N)". Advisors read that as being asked
// to confirm twice — and before the pill-gate fix, clicking the primary first
// silently submitted a decline. Now every row starts INCLUDED (the advisor asked
// for these), one primary approves the checked rows, a checkbox leaves one out,
// and the primary is unavailable when nothing is checked.
describe("ApprovalCard — one click approves; unticking leaves a row out", () => {
  const onePreview = [previews[0]];
  const oneCall = [calls[0]];

  it("single change: the primary approves — it does not decline", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={onePreview} calls={oneCall} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
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
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Reject", "Approve"]);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("multi change: every row starts included and one click approves them all", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeChecked();
    // No pill to hunt for first — this is the whole interaction.
    fireEvent.click(screen.getByRole("button", { name: /approve all 2/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "confirm", call_b: "confirm" });
  });

  it("multi change: unticking a row leaves just that row out", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Remove brokerage account/i }));
    fireEvent.click(screen.getByRole("button", { name: /approve 1 of 2/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "confirm", call_b: "reject" });
  });

  it("multi change: with every row unticked the primary is unavailable", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    const primary = screen.getByRole("button", { name: /approve 0 of 2/i });
    expect(primary.hasAttribute("disabled")).toBe(true);
    fireEvent.click(primary);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("multi change: declining everything is an explicit, labelled action", () => {
    const onCancel = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /decline all/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("multi change: exactly two buttons — no per-row pills, no batch helpers", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Decline all", "Approve all 2"]);
  });
});
