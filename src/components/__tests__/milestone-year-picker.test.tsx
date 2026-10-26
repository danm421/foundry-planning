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
    expect(modeSelect().value).toBe("plan_start");

    fireEvent.click(screen.getByRole("button", { name: "re-date" }));

    // The milestone has to clear too — 2034 is not the plan's first year.
    expect(modeSelect().value).toBe("manual");
    expect(yearInput().value).toBe("2034");
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
    expect(screen.getByText("→ 2034")).toBeTruthy();
  });

  it("stays on a milestone while the parent stores what it emits", () => {
    const { container } = render(<Host initialYear={2026} initialRef="plan_start" />);
    fireEvent.change(modeSelect(), { target: { value: "client_retirement" } });

    expect(modeSelect().value).toBe("client_retirement");
    expect(formYear(container)).toBe("2041");
  });
});

/** The value FormData carries, whatever the visible box shows mid-typing. */
const formYear = (container: HTMLElement) =>
  (container.querySelector('input[name="year"]') as HTMLInputElement).value;

// Dan born 1976, Jane born 1978 — Dan turns 65 in 2041.
const COUPLE: ClientMilestones = { ...MILESTONES, clientBirthYear: 1976, spouseBirthYear: 1978 };

function CoupleHost({ initialYear = 2030, minYear }: { initialYear?: number; minYear?: number }) {
  const [year, setYear] = useState(initialYear);
  return (
    <MilestoneYearPicker
      name="year"
      id="year"
      label="Year"
      value={year}
      yearRef={null}
      milestones={COUPLE}
      clientFirstName="Dan"
      spouseFirstName="Jane"
      minYear={minYear}
      onChange={(y) => setYear(y)}
    />
  );
}

describe("MilestoneYearPicker — year or age", () => {
  it("shows both ages beside a typed year", () => {
    render(<CoupleHost />);
    fireEvent.change(yearInput(), { target: { value: "2041" } });

    const readout = screen.getByTitle("Dan 65 · Jane 63");
    expect(readout.textContent).toBe("Dan 65 · Jane 63");
  });

  it("reads two digits as the client's age and settles on the year", () => {
    const { container } = render(<CoupleHost />);
    fireEvent.focus(yearInput());
    fireEvent.change(yearInput(), { target: { value: "65" } });

    // The reading shows at once; the save waits for blur, since "65" may yet
    // become a longer number.
    expect(screen.getByTitle("2041 · Dan 65 · Jane 63").textContent).toBe("→ 2041 · Dan 65 · Jane 63");
    expect(formYear(container)).toBe("2030");

    fireEvent.blur(yearInput());
    expect(formYear(container)).toBe("2041");
    expect(yearInput().value).toBe("2041");
  });

  it("saves an age on Enter, so a form submitted from the box carries it", () => {
    const { container } = render(<CoupleHost />);
    fireEvent.focus(yearInput());
    fireEvent.change(yearInput(), { target: { value: "65" } });
    fireEvent.keyDown(yearInput(), { key: "Enter" });

    expect(formYear(container)).toBe("2041");
  });

  it("holds the last good year while a year is still being typed", () => {
    const { container } = render(<CoupleHost />);
    fireEvent.focus(yearInput());
    fireEvent.change(yearInput(), { target: { value: "2" } });
    // "20" is age 20 → 1996, before the earliest allowed year: not a reading.
    fireEvent.change(yearInput(), { target: { value: "20" } });
    fireEvent.change(yearInput(), { target: { value: "204" } });

    expect(formYear(container)).toBe("2030");
  });

  it("names the floor for a year below it and reverts on blur", () => {
    const { container } = render(<CoupleHost minYear={2035} />);
    fireEvent.focus(yearInput());
    fireEvent.change(yearInput(), { target: { value: "2031" } });

    expect(screen.getByText("2035 or later")).toBeTruthy();
    expect(formYear(container)).toBe("2030");

    fireEvent.blur(yearInput());
    expect(yearInput().value).toBe("2030");
  });

  it("shows the ages a milestone lands on", () => {
    render(<CoupleHost />);
    fireEvent.change(modeSelect(), { target: { value: "client_retirement" } });

    expect(screen.getByTitle("Dan 65 · Jane 63")).toBeTruthy();
  });
});
