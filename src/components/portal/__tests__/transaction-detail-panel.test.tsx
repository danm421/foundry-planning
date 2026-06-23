// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";

const txn = {
  id: "t1", date: "2026-06-01", name: "AMZN MKTP", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: "c", categoryName: "Shopping", categoryColor: "var(--data-purple)",
  categorizedBy: "manual" as const, accountId: "a1", accountName: "Everyday Checking", accountMask: "4321",
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

  it("shows the source account with its mask", () => {
    render(<TransactionDetailPanel txn={txn} onClose={() => {}} onCreateRule={() => {}} />);
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getByText("Everyday Checking")).toBeTruthy();
    expect(screen.getByText(/4321/)).toBeTruthy();
  });

  it("omits the account row when no account is linked", () => {
    render(
      <TransactionDetailPanel
        txn={{ ...txn, accountName: null, accountMask: null }}
        onClose={() => {}}
        onCreateRule={() => {}}
      />,
    );
    expect(screen.queryByText("Account")).toBeNull();
  });
});
