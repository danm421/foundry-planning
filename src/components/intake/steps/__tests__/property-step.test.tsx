// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { PropertyStep } from "../property-step";

type PropertySlice = IntakeDraft["property"];

function makeProps(overrides: Partial<{ value: PropertySlice; onChange: (v: PropertySlice) => void }> = {}) {
  return {
    value: [] as PropertySlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("PropertyStep", () => {
  it("renders an Add property button when the list is empty", () => {
    render(<PropertyStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add property/i })).toBeInTheDocument();
  });

  it("clicking Add property calls onChange with a new property entry", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add property/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: PropertySlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
  });

  it("renders existing property with name, kind select, and value inputs", () => {
    const value: PropertySlice = [
      { name: "Main residence", kind: "real_estate", value: 850000 },
    ];
    render(<PropertyStep {...makeProps({ value })} />);

    expect(screen.getByDisplayValue("Main residence")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /kind/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("850000")).toBeInTheDocument();
  });

  it("editing name calls onChange with updated name", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      { name: "Old name", kind: "real_estate", value: 500000 },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByDisplayValue("Old name"), { target: { value: "Lake house" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.name).toBe("Lake house");
  });

  it("changing kind calls onChange with the new kind", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      { name: "Biz", kind: "real_estate", value: 0 },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);

    const kindSelect = screen.getByRole("combobox", { name: /kind/i });
    fireEvent.change(kindSelect, { target: { value: "business" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.kind).toBe("business");
  });

  it("changing value calls onChange with numeric value", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      { name: "Home", kind: "real_estate", value: 0 },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);

    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "650000" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.value).toBe(650000);
  });

  it("clicking Remove calls onChange without that property", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      { name: "Home", kind: "real_estate", value: 500000 },
      { name: "Business", kind: "business", value: 200000 },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledOnce();
    const next: PropertySlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Business");
  });
});
