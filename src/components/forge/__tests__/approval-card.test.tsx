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
  it("reject-all sets every row to reject", () => {
    const onSubmit = vi.fn();
    render(<ApprovalCard previews={previews} calls={calls} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm row 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));
    expect(onSubmit).toHaveBeenCalledWith({ call_a: "reject", call_b: "reject" });
  });
  it("disables actions while busy", () => {
    render(<ApprovalCard previews={previews} calls={calls} busy onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /apply selected/i }).hasAttribute("disabled")).toBe(true);
  });
});
