// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { GoalsStep } from "../goals-step";

type GoalsSlice = IntakeDraft["goals"];

function makeProps(overrides: Partial<{ value: GoalsSlice; onChange: (v: GoalsSlice) => void }> = {}) {
  return {
    value: {} as GoalsSlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("GoalsStep", () => {
  it("renders the retirement-age spinbuttons and the money expenses field", () => {
    render(<GoalsStep {...makeProps()} />);

    expect(screen.getByRole("spinbutton", { name: /client.*retirement age/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /spouse.*retirement age/i })).toBeInTheDocument();
    // annual expenses is now a formatted money field (text input)
    expect(screen.getByRole("textbox", { name: /annual retirement expenses/i })).toBeInTheDocument();
  });

  it("renders existing values in the inputs", () => {
    const value: GoalsSlice = {
      clientRetirementAge: 65,
      spouseRetirementAge: 63,
      annualRetirementExpenses: 80000,
    };
    render(<GoalsStep {...makeProps({ value })} />);

    expect((screen.getByRole("spinbutton", { name: /client.*retirement age/i }) as HTMLInputElement).value).toBe("65");
    expect((screen.getByRole("spinbutton", { name: /spouse.*retirement age/i }) as HTMLInputElement).value).toBe("63");
    // expenses formats with separators: 80000 → "80,000"
    expect((screen.getByRole("textbox", { name: /annual retirement expenses/i }) as HTMLInputElement).value).toBe("80,000");
  });

  it("changing clientRetirementAge calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /client.*retirement age/i }), {
      target: { value: "67" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.clientRetirementAge).toBe(67);
  });

  it("changing spouseRetirementAge calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /spouse.*retirement age/i }), {
      target: { value: "62" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.spouseRetirementAge).toBe(62);
  });

  it("changing annualRetirementExpenses calls onChange with updated numeric value", () => {
    const onChange = vi.fn();
    render(<GoalsStep {...makeProps({ onChange })} />);

    fireEvent.change(screen.getByRole("textbox", { name: /annual retirement expenses/i }), {
      target: { value: "90000" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.annualRetirementExpenses).toBe(90000);
  });

  it("clearing a field calls onChange with undefined for that field", () => {
    const onChange = vi.fn();
    const value: GoalsSlice = { clientRetirementAge: 65 };
    render(<GoalsStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /client.*retirement age/i }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.clientRetirementAge).toBeUndefined();
  });
});
