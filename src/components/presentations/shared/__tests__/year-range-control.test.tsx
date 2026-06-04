// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { YearRangeControl } from "../year-range-control";

describe("YearRangeControl", () => {
  it("shows Full selected and hides the custom inputs", () => {
    render(<YearRangeControl value="full" onChange={() => {}} />);
    expect((screen.getByLabelText("Full") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Start year")).not.toBeInTheDocument();
  });

  it("switches to a custom range when Custom is picked", () => {
    const onChange = vi.fn();
    render(<YearRangeControl value="full" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Custom"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ startYear: expect.any(Number), endYear: expect.any(Number) }),
    );
  });

  it("edits the start year of a custom range", () => {
    const onChange = vi.fn();
    render(<YearRangeControl value={{ startYear: 2030, endYear: 2050 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2035" } });
    expect(onChange).toHaveBeenCalledWith({ startYear: 2035, endYear: 2050 });
  });
});
