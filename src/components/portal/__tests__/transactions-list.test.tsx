// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TransactionsList from "@/components/portal/transactions-list";

const txn = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "t1", date: "2026-06-01", name: "AMZN", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: null, categoryName: null, categoryColor: null,
  categorizedBy: "plaid", accountId: "a1", ...over,
});

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
    ({ ok: true, json: async () => handler(String(input)) }) as Response) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());

describe("TransactionsList", () => {
  it("renders fetched rows and totals", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } : { transactions: [txn()], total: 1 });
    render(<TransactionsList clientId="c1" editEnabled />);
    await waitFor(() => expect(screen.getByText("Amazon")).toBeTruthy());
    expect(screen.getByText("1 transactions")).toBeTruthy();
  });
  it("shows income (negative Plaid amount) as +$ in good color", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } : { transactions: [txn({ amount: "-1000.00", merchantName: "Payroll" })], total: 1 });
    render(<TransactionsList clientId="c1" editEnabled />);
    await waitFor(() => expect(screen.getByText(/\+\$1,000\.00/)).toBeTruthy());
  });
});
