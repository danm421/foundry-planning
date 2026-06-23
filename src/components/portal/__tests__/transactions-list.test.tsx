// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TransactionsList from "@/components/portal/transactions-list";

const txn = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "t1", date: "2026-06-01", name: "AMZN", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: null, categoryName: null, categoryColor: null,
  categorizedBy: "plaid", accountId: "a1", accountName: "Everyday Checking", accountMask: "4321",
  type: "expense", ...over,
});

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
    ({ ok: true, json: async () => handler(String(input)) }) as Response) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());

describe("TransactionsList", () => {
  it("renders fetched rows and totals", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } :
      url.includes("/recurrings") ? { recurrings: [] } :
      { transactions: [txn()], total: 1 });
    render(<TransactionsList clientId="c1" editEnabled />);
    await waitFor(() => expect(screen.getByText("Amazon")).toBeTruthy());
    expect(screen.getByText("1 transactions")).toBeTruthy();
  });
  it("shows income (negative Plaid amount) as +$ in good color", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } :
      url.includes("/recurrings") ? { recurrings: [] } :
      { transactions: [txn({ amount: "-1000.00", merchantName: "Payroll" })], total: 1 });
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
      if (url.includes("/recurrings")) return { recurrings: [] };
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
      if (url.includes("/recurrings")) return { recurrings: [] };
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

  it("renders a day-group header and a signed expense amount", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } :
      url.includes("/recurrings") ? { recurrings: [] } :
      { transactions: [txn({ date: "2026-05-30", amount: "17.06" })], total: 1 });
    render(<TransactionsList clientId="c1" editEnabled />);
    await waitFor(() => expect(screen.getByText("SAT, MAY 30")).toBeTruthy());
    expect(screen.getByText("-$17.06")).toBeTruthy();
  });

  it("hides the category control for an internal transfer and shows a T badge", async () => {
    mockFetch((url) =>
      url.includes("/categories") ? { categories: [] } :
      url.includes("/recurrings") ? { recurrings: [] } :
      { transactions: [txn({ type: "transfer", merchantName: "Online Transfer To Chk", amount: "2000.00", categoryName: null })], total: 1 });
    render(<TransactionsList clientId="c1" editEnabled />);
    await waitFor(() => expect(screen.getByText("Online Transfer To Chk")).toBeTruthy());
    expect(screen.getByText("T")).toBeTruthy();
    // No "Uncategorized" / category picker rendered for a transfer row.
    expect(screen.queryByText("Uncategorized")).toBeNull();
  });

  it("picking a category fires PUT with categoryId and optimistically updates the pill label", async () => {
    const cats = [
      { id: "g1", name: "Food & Drink", kind: "group" as const, parentId: null, color: null },
      { id: "l1", name: "Groceries", kind: "category" as const, parentId: "g1", color: "#4CAF50" },
    ];

    const putCalls: { url: string; method: string; body: unknown }[] = [];

    // Override fetch to handle GET (categories + transactions) and PUT.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "PUT") {
        const body = JSON.parse(init?.body as string) as unknown;
        putCalls.push({ url, method, body });
        return { ok: true, json: async () => ({}) } as Response;
      }
      // GET handlers
      if (url.includes("/categories")) {
        return { ok: true, json: async () => ({ categories: cats }) } as Response;
      }
      if (url.includes("/recurrings")) {
        return { ok: true, json: async () => ({ recurrings: [] }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          transactions: [txn({ id: "t1", categoryId: null, categoryName: null })],
          total: 1,
        }),
      } as Response;
    }) as unknown as typeof fetch;

    render(<TransactionsList clientId="c1" editEnabled />);

    // Wait for the row and the category picker to appear.
    await waitFor(() => expect(screen.getByText("Amazon")).toBeTruthy());

    // The CategoryPicker select should be present (editEnabled=true).
    // There are two comboboxes: the filter dropdown (has "All categories") and the row picker (has "Uncategorized").
    // Target the row-level picker by its "Uncategorized" option.
    const allPickers = screen.getAllByRole("combobox");
    const picker = allPickers.find((el) =>
      Array.from((el as HTMLSelectElement).options).some((o) => o.text === "Uncategorized"),
    )!;

    // Pick "Groceries" (id = "l1").
    fireEvent.change(picker, { target: { value: "l1" } });

    // Assert the PUT was fired with the correct URL and body.
    await waitFor(() => expect(putCalls.length).toBe(1));
    expect(putCalls[0].url).toContain("/api/portal/transactions/t1");
    expect(putCalls[0].method).toBe("PUT");
    expect(putCalls[0].body).toEqual({ categoryId: "l1" });

    // The picker's selected value should reflect the optimistic update.
    expect((picker as HTMLSelectElement).value).toBe("l1");
  });
});
