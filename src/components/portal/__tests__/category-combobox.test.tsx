// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryComboBox } from "@/components/portal/category-combobox";

const cats = [
  { id: "g1", name: "Food & Drink", kind: "group" as const, parentId: null, color: null },
  { id: "l1", name: "Groceries", kind: "category" as const, parentId: "g1", color: "#4CAF50" },
  { id: "l2", name: "Restaurants", kind: "category" as const, parentId: "g1", color: "#FF9800" },
  { id: "g2", name: "Transportation", kind: "group" as const, parentId: null, color: null },
  { id: "l3", name: "Gas", kind: "category" as const, parentId: "g2", color: "#2196F3" },
];

beforeEach(() => vi.restoreAllMocks());

function open() {
  render(
    <CategoryComboBox categories={cats} value={null} currentName={null} currentColor={null} onPick={vi.fn()} />,
  );
  fireEvent.click(screen.getByTitle("Change category"));
}

describe("CategoryComboBox", () => {
  it("opens a searchable popover listing grouped leaves", () => {
    open();
    expect(screen.getByPlaceholderText(/Search categories/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Groceries/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gas/ })).toBeTruthy();
  });

  it("filters the list as you type", () => {
    open();
    fireEvent.change(screen.getByPlaceholderText(/Search categories/i), { target: { value: "gro" } });
    expect(screen.getByRole("button", { name: /Groceries/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gas/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restaurants/ })).toBeNull();
  });

  it("reports the picked category id and closes", () => {
    const onPick = vi.fn();
    render(
      <CategoryComboBox categories={cats} value={null} currentName={null} currentColor={null} onPick={onPick} />,
    );
    fireEvent.click(screen.getByTitle("Change category"));
    fireEvent.click(screen.getByRole("button", { name: /Restaurants/ }));
    expect(onPick).toHaveBeenCalledWith("l2");
    // Popover closed → search box gone.
    expect(screen.queryByPlaceholderText(/Search categories/i)).toBeNull();
  });

  it("Enter picks the first match", () => {
    const onPick = vi.fn();
    render(
      <CategoryComboBox categories={cats} value={null} currentName={null} currentColor={null} onPick={onPick} />,
    );
    fireEvent.click(screen.getByTitle("Change category"));
    const search = screen.getByPlaceholderText(/Search categories/i);
    fireEvent.change(search, { target: { value: "gas" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("l3");
  });
});
