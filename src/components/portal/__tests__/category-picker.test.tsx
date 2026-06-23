// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryPicker } from "@/components/portal/category-picker";

const cats = [
  { id: "g1", name: "Food & Drink", kind: "group" as const, parentId: null },
  { id: "l1", name: "Groceries", kind: "category" as const, parentId: "g1" },
];

describe("CategoryPicker", () => {
  it("renders grouped leaves + Uncategorized and reports picks", () => {
    const onPick = vi.fn();
    render(<CategoryPicker categories={cats} value={null} onPick={onPick} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "l1" } });
    expect(onPick).toHaveBeenCalledWith("l1");
  });
  it("maps the empty option back to null", () => {
    const onPick = vi.fn();
    render(<CategoryPicker categories={cats} value="l1" onPick={onPick} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onPick).toHaveBeenCalledWith(null);
  });
});
