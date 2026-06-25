// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionDetailPanel } from "@/components/portal/transaction-detail-panel";

const txn = {
  id: "t1", date: "2026-06-01", name: "AMZN MKTP", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: "c", categoryName: "Shopping", categoryColor: "var(--data-purple)",
  categorizedBy: "manual" as const, accountId: "a1", accountName: "Everyday Checking", accountMask: "4321",
  type: "expense" as const, source: "plaid" as const,
};

describe("TransactionDetailPanel", () => {
  it("shows merchant, provenance, and fires onCreateRule", () => {
    const onCreateRule = vi.fn();
    render(<TransactionDetailPanel txn={txn} onClose={() => {}} onCreateRule={onCreateRule} onCreateRecurring={() => {}} recurrings={[]} onLinkRecurring={() => {}} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Set by you")).toBeTruthy();
    fireEvent.click(screen.getByText(/Create rule/));
    expect(onCreateRule).toHaveBeenCalled();
  });

  it("shows the source account with its mask", () => {
    render(<TransactionDetailPanel txn={txn} onClose={() => {}} onCreateRule={() => {}} onCreateRecurring={() => {}} recurrings={[]} onLinkRecurring={() => {}} />);
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
        onCreateRecurring={() => {}}
        recurrings={[]}
        onLinkRecurring={() => {}}
      />,
    );
    expect(screen.queryByText("Account")).toBeNull();
  });

  it("renders the type switcher and fires onChangeType", () => {
    const onChangeType = vi.fn();
    render(
      <TransactionDetailPanel
        txn={{ ...txn, type: "expense" }}
        editEnabled
        onChangeType={onChangeType}
        onClose={() => {}} onCreateRule={() => {}} onCreateRecurring={() => {}}
        recurrings={[]} onLinkRecurring={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(onChangeType).toHaveBeenCalledWith("transfer");
  });

  it("hides the Category row for a transfer", () => {
    render(
      <TransactionDetailPanel
        txn={{ ...txn, type: "transfer" }}
        onClose={() => {}} onCreateRule={() => {}} onCreateRecurring={() => {}}
        recurrings={[]} onLinkRecurring={() => {}}
      />,
    );
    expect(screen.queryByText("Category")).toBeNull();
  });

  it("shows Edit/Delete for a manual row and hides them for a plaid row", () => {
    const base = {
      id: "t1", date: "2026-02-02", name: "Cash lunch", merchantName: null, amount: "12.00",
      pending: false, excluded: false, categoryId: null, categoryName: null, categoryColor: null,
      categorizedBy: "manual" as const, accountId: null, accountName: null, accountMask: null,
      type: "expense" as const,
    };
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { rerender } = render(
      <TransactionDetailPanel
        txn={{ ...base, source: "manual" }}
        editEnabled
        onClose={() => {}} onCreateRule={() => {}} onCreateRecurring={() => {}}
        recurrings={[]} onLinkRecurring={() => {}} onEdit={onEdit} onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("Edit"));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();

    rerender(
      <TransactionDetailPanel
        txn={{ ...base, source: "plaid" }}
        editEnabled
        onClose={() => {}} onCreateRule={() => {}} onCreateRecurring={() => {}}
        recurrings={[]} onLinkRecurring={() => {}}
      />,
    );
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
