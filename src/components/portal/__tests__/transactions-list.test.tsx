// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("Load more appends a second page without replacing the first", async () => {
    // Build 50 unique page-1 rows and 1 page-2 row so hasMore is true after page 1.
    const page1 = Array.from({ length: 50 }, (_, i) =>
      txn({ id: `p1-${i}`, merchantName: `Merchant-P1-${i}` }),
    );
    const page2 = [txn({ id: "p2-0", merchantName: "Merchant-P2-Unique" })];

    let txnCallCount = 0;
    mockFetch((url) => {
      if (url.includes("/categories")) return { categories: [] };
      txnCallCount++;
      // First /transactions call → page 1 (total 51 so hasMore is true)
      // Second call → page 2
      return txnCallCount === 1
        ? { transactions: page1, total: 51 }
        : { transactions: page2, total: 51 };
    });

    render(<TransactionsList clientId="c1" editEnabled />);

    // Wait for page 1 to render.
    await waitFor(() => expect(screen.getByText("Merchant-P1-0")).toBeTruthy());
    expect(screen.queryByText("Merchant-P2-Unique")).toBeNull();

    // Click "Load more".
    const loadMoreBtn = screen.getByRole("button", { name: /Load more/i });
    fireEvent.click(loadMoreBtn);

    // Both pages should now be visible.
    await waitFor(() => expect(screen.getByText("Merchant-P2-Unique")).toBeTruthy());
    // Page-1 rows are still present (not replaced).
    expect(screen.getByText("Merchant-P1-0")).toBeTruthy();
    expect(screen.getByText("Merchant-P1-49")).toBeTruthy();
  });

  it("typing in the search box triggers a refetch whose URL contains the query string", async () => {
    const fetchedUrls: string[] = [];
    mockFetch((url) => {
      if (url.includes("/categories")) return { categories: [] };
      fetchedUrls.push(url);
      return { transactions: [txn()], total: 1 };
    });

    render(<TransactionsList clientId="c1" editEnabled />);

    // Wait for the initial load.
    await waitFor(() => expect(screen.getByText("Amazon")).toBeTruthy());
    const urlsBefore = fetchedUrls.length;

    // Type into the search input.
    const searchInput = screen.getByPlaceholderText(/Search merchant/i);
    fireEvent.change(searchInput, { target: { value: "Starbucks" } });

    // A new /transactions fetch should fire with q=Starbucks in the URL.
    await waitFor(() =>
      expect(fetchedUrls.slice(urlsBefore).some((u) => u.includes("q=Starbucks"))).toBe(true),
    );
  });
});
