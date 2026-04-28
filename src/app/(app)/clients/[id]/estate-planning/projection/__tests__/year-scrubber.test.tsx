// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { YearScrubber } from "../year-scrubber";

describe("YearScrubber", () => {
  it("renders the active year in the header with font-mono class", () => {
    render(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2030}
        onChange={vi.fn()}
      />,
    );
    // The active-year header is the first occurrence (tick row may also show
    // a sibling "2030" if it lands on a tick, so scope to the first match).
    const matches = screen.getAllByText("2030");
    expect(matches[0]).toHaveClass("font-mono");
  });

  it("preset buttons snap to the right year", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2026}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^1st$/i }));
    expect(onChange).toHaveBeenLastCalledWith(2048);
    await user.click(screen.getByRole("button", { name: /^2nd$/i }));
    expect(onChange).toHaveBeenLastCalledWith(2054);
    await user.click(screen.getByRole("button", { name: /\+10y/i }));
    expect(onChange).toHaveBeenLastCalledWith(2036);
  });

  it("hidden range input drives onChange via fireEvent.change", () => {
    const onChange = vi.fn();
    render(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2026}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-label", "Year scrubber");
    fireEvent.change(slider, { target: { value: "2040" } });
    expect(onChange).toHaveBeenCalledWith(2040);
  });

  it("active-event pill colors at death years", () => {
    // Below first death: no pill rendered.
    const { rerender } = render(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2030}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/first death/i)).toBeNull();
    expect(screen.queryByText(/second death/i)).toBeNull();

    // At first-death year — first-death pill (bg-tax/15).
    rerender(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2048}
        onChange={vi.fn()}
      />,
    );
    const firstPill = screen.getByText(/first death/i);
    expect(firstPill.className).toMatch(/bg-tax\/15/);

    // At second-death year — second-death pill (bg-crit/15 text-crit).
    rerender(
      <YearScrubber
        currentYear={2026}
        firstDeathYear={2048}
        secondDeathYear={2054}
        value={2054}
        onChange={vi.fn()}
      />,
    );
    const secondPill = screen.getByText(/second death/i);
    expect(secondPill.className).toMatch(/bg-crit\/15/);
    expect(secondPill.className).toMatch(/text-crit/);
  });
});
