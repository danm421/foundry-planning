// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ManualTransactionDialog } from "@/components/portal/manual-transaction-dialog";

const cats = [
  { id: "g1", name: "Food", kind: "group" as const, parentId: null },
  { id: "l1", name: "Restaurants", kind: "category" as const, parentId: "g1" },
];

beforeEach(() => vi.restoreAllMocks());

describe("ManualTransactionDialog", () => {
  it("creates an expense via POST with the form magnitude", async () => {
    const postBodies: any[] = [];
    const calls: { url: string; method?: string }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.includes("/api/portal/accounts")) return { ok: true, json: async () => ({ accounts: [] }) } as Response;
      if (init?.method === "POST") postBodies.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ ok: true, id: "t1" }) } as Response;
    }) as unknown as typeof fetch;

    const onSaved = vi.fn();
    render(<ManualTransactionDialog categories={cats} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "42.50" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Cash lunch" } });
    fireEvent.click(screen.getByText("Add transaction"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(postBodies[0]).toMatchObject({ amount: 42.5, type: "expense", name: "Cash lunch" });
    expect(calls.some((c) => c.url.endsWith("/api/portal/transactions") && c.method === "POST")).toBe(true);
  });

  it("prefills from a manual txn and saves via PUT", async () => {
    const putBodies: any[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/portal/accounts")) return { ok: true, json: async () => ({ accounts: [] }) } as Response;
      if (init?.method === "PUT") putBodies.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }) as unknown as typeof fetch;

    const onSaved = vi.fn();
    const txn = {
      id: "t9", date: "2026-02-02", name: "Old", merchantName: null, amount: "-30.00",
      pending: false, excluded: false, categoryId: "l1", categoryName: "Restaurants",
      categoryColor: null, categorizedBy: "manual" as const, accountId: null, accountName: null,
      accountMask: null, type: "income" as const, source: "manual" as const,
    };
    render(<ManualTransactionDialog txn={txn} categories={cats} onClose={() => {}} onSaved={onSaved} />);

    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("30");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "45" } });
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(putBodies[0]).toMatchObject({ amount: 45, type: "income", name: "Old" });
  });
});
