// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { AccountsStep } from "../accounts-step";

type AccountsSlice = IntakeDraft["accounts"];

const emptyValue: AccountsSlice = [];

function makeProps(overrides: Partial<{ value: AccountsSlice; onChange: (v: AccountsSlice) => void }> = {}) {
  return {
    value: emptyValue,
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("AccountsStep", () => {
  it("renders an Add account button when the list is empty", () => {
    render(<AccountsStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add account/i })).toBeInTheDocument();
  });

  it("clicking Add account calls onChange with a new account entry", () => {
    const onChange = vi.fn();
    render(<AccountsStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add account/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
  });

  it("renders existing accounts with name, category select, and value inputs", () => {
    const value: AccountsSlice = [
      { name: "Fidelity Brokerage", category: "taxable", value: 100000 },
    ];
    render(<AccountsStep {...makeProps({ value })} />);

    expect(screen.getByDisplayValue("Fidelity Brokerage")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /category/i })).toBeInTheDocument();
    // value input is now a formatted money field: 100000 → "100,000"
    expect(screen.getByDisplayValue("100,000")).toBeInTheDocument();
  });

  it("editing the name calls onChange with updated account name", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Fidelity", category: "taxable", value: 50000 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    const nameInput = screen.getByDisplayValue("Fidelity");
    fireEvent.change(nameInput, { target: { value: "Vanguard" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.name).toBe("Vanguard");
  });

  it("changing category calls onChange with the new category", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "IRA", category: "taxable", value: 0 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    const catSelect = screen.getByRole("combobox", { name: /category/i });
    fireEvent.change(catSelect, { target: { value: "retirement" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.category).toBe("retirement");
  });

  it("changing value calls onChange with the numeric value", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Savings", category: "cash", value: 0 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    const valInput = screen.getByDisplayValue("0");
    fireEvent.change(valInput, { target: { value: "25000" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.value).toBe(25000);
  });

  it("clicking Remove calls onChange without that account", () => {
    const onChange = vi.fn();
    const value: AccountsSlice = [
      { name: "Account A", category: "taxable", value: 1000 },
      { name: "Account B", category: "cash", value: 2000 },
    ];
    render(<AccountsStep {...makeProps({ value, onChange })} />);

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledOnce();
    const next: AccountsSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Account B");
  });
});
