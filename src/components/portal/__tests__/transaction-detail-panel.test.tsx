// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";

const txn = {
  id: "t1", date: "2026-06-01", name: "AMZN MKTP", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: "c", categoryName: "Shopping", categoryColor: "var(--data-purple)",
  categorizedBy: "manual" as const, accountId: "a1",
};

describe("TransactionDetailPanel", () => {
  it("shows merchant, provenance, and fires onCreateRule", () => {
    const onCreateRule = vi.fn();
    render(<TransactionDetailPanel txn={txn} onClose={() => {}} onCreateRule={onCreateRule} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Set by you")).toBeTruthy();
    fireEvent.click(screen.getByText(/Create rule/));
    expect(onCreateRule).toHaveBeenCalled();
  });
});
