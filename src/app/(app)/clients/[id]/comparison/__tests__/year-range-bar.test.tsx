// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YearRangeBar } from "../year-range-bar";

describe("YearRangeBar", () => {
  it("renders 'All years' when yearRange is null", () => {
    render(
      <YearRangeBar
        yearRange={null}
        min={2030}
        max={2065}
        clientBirthYear={1965}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText(/All years/i)).toBeTruthy();
  });

  it("renders the age badge when birth year is provided", () => {
    render(
      <YearRangeBar
        yearRange={{ start: 2032, end: 2060 }}
        min={2030}
        max={2065}
        clientBirthYear={1965}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    // 2032 - 1965 = 67, 2060 - 1965 = 95
    expect(screen.getByText(/Age 67 → Age 95/)).toBeTruthy();
  });

  it("hides the age badge when birth year is undefined", () => {
    render(
      <YearRangeBar
        yearRange={{ start: 2032, end: 2060 }}
        min={2030}
        max={2065}
        clientBirthYear={undefined}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Age \d+/)).toBeNull();
  });

  it("calls onReset when the reset button is clicked", () => {
    const onReset = vi.fn();
    render(
      <YearRangeBar
        yearRange={{ start: 2032, end: 2060 }}
        min={2030}
        max={2065}
        clientBirthYear={1965}
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(onReset).toHaveBeenCalled();
  });

  it("calls onChange with the new range when start input changes", () => {
    const onChange = vi.fn();
    render(
      <YearRangeBar
        yearRange={{ start: 2032, end: 2060 }}
        min={2030}
        max={2065}
        clientBirthYear={1965}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );
    const startInput = screen.getByLabelText("Start year") as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2040" } });
    expect(onChange).toHaveBeenCalledWith({ start: 2040, end: 2060 });
  });
});
