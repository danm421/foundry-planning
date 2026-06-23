// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CategoriesManager from "@/components/portal/categories-manager";

const seed = [
  { id: "g1", name: "Food", kind: "group", parentId: null, color: "var(--data-orange)", isSystem: true, sortOrder: 30 },
  { id: "l1", name: "Groceries", kind: "category", parentId: "g1", color: "var(--data-orange)", isSystem: true, sortOrder: 0 },
  { id: "l2", name: "Snacks", kind: "category", parentId: "g1", color: "var(--data-orange)", isSystem: false, sortOrder: 1 },
];

beforeEach(() => vi.restoreAllMocks());

describe("CategoriesManager", () => {
  it("renders groups/leaves and only user leaves get Delete", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ categories: seed }) }) as Response) as unknown as typeof fetch;
    render(<CategoriesManager editEnabled />);
    await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());
    // exactly one Delete button (for the non-system "Snacks")
    expect(screen.getAllByText("Delete")).toHaveLength(1);
  });

  it("Add POSTs the right shape", async () => {
    const postBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") postBodies.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ categories: seed }) } as Response;
    }) as unknown as typeof fetch;

    render(<CategoriesManager editEnabled />);
    await waitFor(() => expect(screen.getByText("Food")).toBeTruthy());

    const addInput = screen.getByPlaceholderText("Add category…");
    fireEvent.change(addInput, { target: { value: "Takeout" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(postBodies.length).toBeGreaterThan(0));
    expect(postBodies[0]).toEqual({ name: "Takeout", kind: "category", parentId: "g1" });
  });

  it("Delete DELETEs with reassignToId", async () => {
    const deleteBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") deleteBodies.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ categories: seed }) } as Response;
    }) as unknown as typeof fetch;

    render(<CategoriesManager editEnabled />);
    await waitFor(() => expect(screen.getByText("Snacks")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    // reassign select defaults to "" (Uncategorize); click Confirm immediately
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(deleteBodies.length).toBeGreaterThan(0));
    expect(deleteBodies[0]).toEqual({ reassignToId: null });
  });

  it("preview mode is read-only (no Add, Delete, or recolor controls)", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ categories: seed }) }) as Response) as unknown as typeof fetch;
    render(<CategoriesManager editEnabled={false} />);
    await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());

    expect(screen.queryByPlaceholderText("Add category…")).toBeNull();
    expect(screen.queryByText("Add")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    // no recolor selects (the only selects in editEnabled mode)
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});
