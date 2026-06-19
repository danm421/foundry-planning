// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StateSelect } from "../state-select";

describe("StateSelect", () => {
  it("renders all 50 states + DC plus a placeholder", () => {
    render(<StateSelect id="s" name="s" value="" onChange={() => {}} />);
    // 51 jurisdictions + 1 placeholder option
    expect(screen.getAllByRole("option")).toHaveLength(52);
    expect(screen.getByRole("option", { name: "California" })).toBeDefined();
  });

  it("calls onChange with the selected USPS code", () => {
    const onChange = vi.fn();
    render(<StateSelect id="s" name="s" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TX" } });
    expect(onChange).toHaveBeenCalledWith("TX");
  });
});
