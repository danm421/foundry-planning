// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IncomeStep } from "../income-step";

type IncomeSlice = IntakeDraft["income"];

function makeProps(overrides: Partial<{ value: IncomeSlice; onChange: (v: IncomeSlice) => void }> = {}) {
  return {
    value: [] as IncomeSlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("IncomeStep", () => {
  it("renders an Add income button when the list is empty", () => {
    render(<IncomeStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
  });

  it("clicking Add income calls onChange with a new income entry", () => {
    const onChange = vi.fn();
    render(<IncomeStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
  });

  it("renders existing income with name, type, annualAmount, and owner inputs", () => {
    const value: IncomeSlice = [
      { name: "Day job", type: "salary", annualAmount: 120000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expect(screen.getByDisplayValue("Day job")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /type/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("120000")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toBeInTheDocument();
  });

  it("editing name calls onChange with updated name", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Old job", type: "salary", annualAmount: 80000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByDisplayValue("Old job"), { target: { value: "New job" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.name).toBe("New job");
  });

  it("changing type calls onChange with the new type", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "SS", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    const typeSelect = screen.getByRole("combobox", { name: /type/i });
    fireEvent.change(typeSelect, { target: { value: "social_security" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.type).toBe("social_security");
  });

  it("changing annualAmount calls onChange with numeric amount", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "95000" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.annualAmount).toBe(95000);
  });

  it("changing owner calls onChange with the new owner", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Joint income", type: "other", annualAmount: 10000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    const ownerSelect = screen.getByRole("combobox", { name: /owner/i });
    fireEvent.change(ownerSelect, { target: { value: "joint" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.owner).toBe("joint");
  });

  it("clicking Remove calls onChange without that income entry", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Salary A", type: "salary", annualAmount: 100000, owner: "client" },
      { name: "Salary B", type: "salary", annualAmount: 80000, owner: "spouse" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledOnce();
    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Salary B");
  });
});
