// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LivingExpenseItem } from "@/engine/types";
import LivingExpenseItems, { type LivingExpenseItemsProps } from "../living-expense-items";

const HOUSING: LivingExpenseItem = { id: "i1", name: "Housing", amount: 3200, frequency: "monthly" };
const TRAVEL: LivingExpenseItem = { id: "i2", name: "Travel", amount: 12000, frequency: "annual" };

function setup(over: Partial<LivingExpenseItemsProps> = {}) {
  const props: LivingExpenseItemsProps = {
    rowName: "Current Living Expenses",
    items: [HOUSING, TRAVEL],
    annualAmount: 50400,
    canEdit: true,
    hasSchedule: false,
    error: null,
    onSave: vi.fn().mockResolvedValue(true),
    onUseItemsTotal: vi.fn().mockResolvedValue(true),
    onMakeGoal: vi.fn(),
    ...over,
  };
  render(<LivingExpenseItems {...props} />);
  return props;
}

describe("LivingExpenseItems", () => {
  it("shows the help line and the add form when the list is empty", () => {
    setup({ items: [], annualAmount: 0 });
    expect(
      screen.getByText("Break this total into items. Once you add one, the items set the total."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add item" })).toBeDisabled();
  });

  it("adds an item with a trimmed name, the cleaned amount and the chosen frequency", async () => {
    const props = setup({ items: [], annualAmount: 0 });
    fireEvent.change(screen.getByLabelText("New item name"), { target: { value: "  Groceries " } });
    fireEvent.change(screen.getByLabelText("New item amount"), { target: { value: "$1,400" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    const [next] = (props.onSave as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ name: "Groceries", amount: 1400, frequency: "monthly" });
    expect(typeof next[0].id).toBe("string");
  });

  it("keeps the add button disabled for a name of only spaces", () => {
    setup({ items: [] });
    fireEvent.change(screen.getByLabelText("New item name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("New item amount"), { target: { value: "100" } });
    expect(screen.getByRole("button", { name: "+ Add item" })).toBeDisabled();
  });

  it("switches an item's frequency", () => {
    const props = setup();
    const group = screen.getByRole("group", { name: "How often for Housing" });
    fireEvent.click(group.querySelector("button[aria-pressed='false']")!);
    expect(props.onSave).toHaveBeenCalledWith([{ ...HOUSING, frequency: "annual" }, TRAVEL]);
  });

  it("deletes an item", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete Travel" }));
    expect(props.onSave).toHaveBeenCalledWith([HOUSING]);
  });

  it("renames on blur, and reverts a blank name without saving", () => {
    const props = setup();
    const name = screen.getByLabelText("Name of Housing");
    fireEvent.change(name, { target: { value: " Rent " } });
    fireEvent.blur(name);
    expect(props.onSave).toHaveBeenCalledWith([{ ...HOUSING, name: "Rent" }, TRAVEL]);

    (props.onSave as ReturnType<typeof vi.fn>).mockClear();
    const travel = screen.getByLabelText("Name of Travel");
    fireEvent.change(travel, { target: { value: "  " } });
    fireEvent.blur(travel);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(travel).toHaveValue("Travel");
  });

  it("hands the item to onMakeGoal", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Make Travel a goal" }));
    expect(props.onMakeGoal).toHaveBeenCalledWith(TRAVEL);
  });

  it("shows the override line and resets to the items' total", () => {
    const props = setup({ annualAmount: 90000 });
    expect(
      screen.getByText("Total set to $90,000 elsewhere — items add up to $50,400"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use items total" }));
    expect(props.onUseItemsTotal).toHaveBeenCalled();
  });

  it("shows no override line when the total matches", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Use items total" })).not.toBeInTheDocument();
  });

  it("notes that a year-by-year schedule wins", () => {
    setup({ hasSchedule: true });
    expect(
      screen.getByText("This row has a year-by-year schedule, which the projection uses instead of these items."),
    ).toBeInTheDocument();
  });

  it("is read-only without edit access", () => {
    setup({ canEdit: false, annualAmount: 90000 });
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Travel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make Travel a goal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use items total" })).not.toBeInTheDocument();
  });

  it("shows a parent's error as an alert", () => {
    setup({ error: "The goal was saved, but Travel is still in living expenses — remove it there." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The goal was saved, but Travel is still in living expenses — remove it there.",
    );
  });
});
