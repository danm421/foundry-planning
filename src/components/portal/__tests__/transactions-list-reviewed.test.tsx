// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionsList from "@/components/portal/transactions-list";

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({ usePortalFetch: () => portalFetchMock }));

const txn = {
  id: "t1", date: "2026-06-20", name: "AMZN", merchantName: "Amazon", amount: "42.00",
  pending: false, excluded: false, categoryId: null, categoryName: null, categoryColor: null,
  categorizedBy: "plaid", accountId: "a1", accountName: "Card", accountMask: "1234",
  type: "expense", reviewed: false,
};

function route(url: string) {
  if (url.startsWith("/api/portal/categories")) return Promise.resolve({ ok: true, json: async () => ({ categories: [] }) });
  if (url.startsWith("/api/portal/recurrings")) return Promise.resolve({ ok: true, json: async () => ({ recurrings: [] }) });
  if (url.startsWith("/api/portal/transactions?")) return Promise.resolve({ ok: true, json: async () => ({ transactions: [txn], total: 1 }) });
  return Promise.resolve({ ok: true, json: async () => ({ ok: true }) }); // PUT
}

beforeEach(() => { portalFetchMock.mockReset(); portalFetchMock.mockImplementation((url: string) => route(url)); });

describe("TransactionsList — reviewed", () => {
  it("toggles reviewed on a row with an optimistic PUT", async () => {
    render(<TransactionsList clientId="c1" editEnabled={true} />);
    await waitFor(() => expect(screen.getByText("Amazon")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Mark as reviewed"));
    await waitFor(() => {
      const put = portalFetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(put?.[0]).toBe("/api/portal/transactions/t1");
      expect(JSON.parse(put![1].body)).toEqual({ reviewed: true });
    });
    expect(screen.getByLabelText("Reviewed")).toBeInTheDocument();
  });

  it("the Unreviewed filter requests reviewed=false", async () => {
    render(<TransactionsList clientId="c1" editEnabled={true} />);
    await waitFor(() => expect(screen.getByText("Amazon")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Unreviewed" }));
    await waitFor(() => {
      const calls = portalFetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("/api/portal/transactions?") && u.includes("reviewed=false"))).toBe(true);
    });
  });
});
