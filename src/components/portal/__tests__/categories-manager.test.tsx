// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
