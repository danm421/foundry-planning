// @vitest-environment jsdom
/**
 * MilestoneYearPicker's prop/state contract. The picker owns its year between
 * edits — it does not re-derive from `value` on every render — so the two ways
 * that ownership can go wrong both need a test: a year the parent sets on its
 * own has to reach the display, and a year the parent merely echoes back has to
 * leave the picker's mode alone.
 *
 * Driven through a controlled host, the way every real caller wires it: the
 * host stores whatever `onChange` reports and feeds it back down as `value`.
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";

const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2071,
  clientRetirement: 2041,
  clientEnd: 2071,
};

/** A caller that stores the picker's year and can also set one itself. */
function Host({
  initialYear,
  initialRef,
  pushYear,
  withDuration = false,
}: {
  initialYear: number;
  initialRef: YearRef | null;
  /** Year the "re-date" button hands down, standing in for an auto-fill. */
  pushYear?: number;
  withDuration?: boolean;
}) {
  const [year, setYear] = useState(initialYear);
  const [ref, setRef] = useState<YearRef | null>(initialRef);
  return (
    <>
      <MilestoneYearPicker
        name="year"
        id="year"
        label="Year"
        value={year}
        yearRef={ref}
        milestones={MILESTONES}
        startYearForDuration={withDuration ? 2030 : undefined}
        onChange={(y, r) => {
          setYear(y);
          setRef(r);
        }}
      />
      {pushYear != null && (
        <button
          type="button"
          onClick={() => {
            setYear(pushYear);
            setRef(null);
          }}
        >
          re-date
        </button>
      )}
    </>
  );
}

const yearInput = () => screen.getByLabelText("Year") as HTMLInputElement;
const modeSelect = () => screen.getByRole("combobox") as HTMLSelectElement;

describe("MilestoneYearPicker", () => {
  it("shows a year the parent sets on its own", () => {
    render(<Host initialYear={2026} initialRef="plan_start" pushYear={2034} />);
    expect(yearInput().value).toBe("2026");

    fireEvent.click(screen.getByRole("button", { name: "re-date" }));

    expect(yearInput().value).toBe("2034");
    // The milestone badge has to clear too — 2034 is not the plan's first year.
    expect(screen.queryByText("First Year")).toBeNull();
    expect(modeSelect().value).toBe("manual");
  });

  it("keeps a parent-set year editable afterward", () => {
    render(<Host initialYear={2026} initialRef="plan_start" pushYear={2034} />);
    fireEvent.click(screen.getByRole("button", { name: "re-date" }));
    fireEvent.change(yearInput(), { target: { value: "2036" } });

    expect(yearInput().value).toBe("2036");
  });

  // The control on the test above: the parent echoing `onChange` back as new
  // props must NOT read as a parent-set year. It changes `value` just the same,
  // so a picker that adopted every changed prop would drop out of Duration on
  // the first keystroke.
  it("stays in duration mode while the parent stores what it emits", () => {
    render(<Host initialYear={2030} initialRef={null} withDuration />);
    fireEvent.change(modeSelect(), { target: { value: "duration" } });
    expect(modeSelect().value).toBe("duration");

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "5" } });

    expect(modeSelect().value).toBe("duration");
    // 2030 + 5 - 1, surfaced next to the duration input.
    expect(screen.getByText(/years → 2034/)).toBeTruthy();
  });

  it("stays on a milestone while the parent stores what it emits", () => {
    render(<Host initialYear={2026} initialRef="plan_start" />);
    fireEvent.change(modeSelect(), { target: { value: "client_retirement" } });

    expect(modeSelect().value).toBe("client_retirement");
    expect(yearInput().value).toBe("2041");
  });
});
