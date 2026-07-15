// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";

// Stub Chart.js's Bar so jsdom never touches <canvas>, and capture the props
// (data + options) it was rendered with so we can assert on the stacked
// datasets / axis / clipping the view builds.
vi.mock("react-chartjs-2", () => ({
  Bar: (props: {
    data: {
      labels: string[];
      datasets: { label: string; data: (number | null)[]; stack?: string }[];
    };
    options: {
      scales?: { x?: { stacked?: boolean }; y?: { stacked?: boolean } };
    };
  }) => {
    (globalThis as Record<string, unknown>).__barProps = props;
    return null;
  },
}));

import { LiNeedOverTimeView } from "../li-need-over-time-view";

type BarProps = {
  data: {
    labels: string[];
    datasets: { label: string; data: (number | null)[]; stack?: string }[];
  };
  options: { scales?: { x?: { stacked?: boolean }; y?: { stacked?: boolean } } };
};

function barProps(): BarProps | undefined {
  return (globalThis as Record<string, unknown>).__barProps as BarProps | undefined;
}

function row(
  year: number,
  clientNeed: number,
  spouseNeed: number | null,
): NeedOverTimeRow {
  return {
    year,
    clientNeed,
    spouseNeed,
    clientStatus: "solved",
    spouseStatus: spouseNeed == null ? null : "solved",
  };
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__barProps;
});

describe("LiNeedOverTimeView — stacked client + spouse", () => {
  it("renders client and spouse as two stacked datasets after the solve completes", () => {
    // All values are exact $50k multiples so roundUpTo50k is the identity.
    const rows = [row(2026, 1_000_000, 500_000), row(2027, 1_500_000, 1_000_000)];

    render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={false}
        progress={null}
        errorMessage={null}
        isMarried={true}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    const { data, options } = barProps()!;
    expect(data.datasets).toHaveLength(2);
    // Client segment first, spouse second — labelled by name.
    expect(data.datasets[0].label).toContain("Alex");
    expect(data.datasets[1].label).toContain("Jordan");
    expect(data.datasets[0].data).toEqual([1_000_000, 1_500_000]);
    expect(data.datasets[1].data).toEqual([500_000, 1_000_000]);
    // Both share one stack so the bars stack rather than group.
    expect(data.datasets[0].stack).toBeDefined();
    expect(data.datasets[0].stack).toBe(data.datasets[1].stack);
    // Axes are stacked.
    expect(options.scales?.x?.stacked).toBe(true);
    expect(options.scales?.y?.stacked).toBe(true);
  });

  it("renders a single client dataset (no spouse) for an unmarried plan", () => {
    render(
      <LiNeedOverTimeView
        rows={[row(2026, 1_000_000, null)]}
        yearRange={{ planStartYear: 2026, planEndYear: 2026 }}
        isRunning={false}
        progress={null}
        errorMessage={null}
        isMarried={false}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    const { data } = barProps()!;
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].label).toContain("Alex");
    expect(data.datasets[0].label).not.toContain("Jordan");
  });

  it("does NOT render the client/spouse toggle (both are shown at once now)", () => {
    const { queryAllByRole } = render(
      <LiNeedOverTimeView
        rows={[row(2026, 1_000_000, 500_000)]}
        yearRange={{ planStartYear: 2026, planEndYear: 2026 }}
        isRunning={false}
        progress={null}
        errorMessage={null}
        isMarried={true}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    expect(queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("LiNeedOverTimeView — clip to the need window", () => {
  it("shows only the years that have a need once the solve is done", () => {
    // Need only in 2028–2029; the flat $0 years before/after are dropped.
    const rows = [
      row(2026, 0, 0),
      row(2027, 0, 0),
      row(2028, 1_000_000, 500_000),
      row(2029, 1_500_000, 0),
      row(2030, 0, 0),
      row(2031, 0, 0),
    ];

    render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2031 }}
        isRunning={false}
        progress={null}
        errorMessage={null}
        isMarried={true}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    const { data } = barProps()!;
    // Only the need window, not the full plan range.
    expect(data.labels).toEqual(["2028", "2029"]);
    expect(data.datasets[0].data).toEqual([1_000_000, 1_500_000]);
    // 2029 spouse is a solved $0 INSIDE the window — kept as 0, not dropped.
    expect(data.datasets[1].data).toEqual([500_000, 0]);
  });

  it("keeps the full stable plan-year axis while the solve is still streaming", () => {
    // Mid-run: only 2026 has streamed in. Axis must still span all plan years
    // so bars rise into place instead of the axis growing underneath.
    const rows = [row(2026, 1_000_000, 500_000)];

    render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2028 }}
        isRunning={true}
        progress={{ done: 1, total: 3 }}
        errorMessage={null}
        isMarried={true}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    const { data } = barProps()!;
    expect(data.labels).toEqual(["2026", "2027", "2028"]);
    // Streamed year gets its value; unsolved years are null gaps.
    expect(data.datasets[0].data).toEqual([1_000_000, null, null]);
    expect(data.datasets[1].data).toEqual([500_000, null, null]);
  });

  it("distinguishes a solved $0 (0) from a pending year (null) while streaming", () => {
    const rows = [row(2026, 0, null)];

    render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={true}
        progress={{ done: 1, total: 2 }}
        errorMessage={null}
        isMarried={false}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    const { data } = barProps()!;
    expect(data.datasets[0].data).toEqual([0, null]);
  });
});

describe("LiNeedOverTimeView — loading + empty states", () => {
  it("shows the animated shield loader (and no chart) before the year range is known", () => {
    const { getByText, container } = render(
      <LiNeedOverTimeView
        rows={null}
        yearRange={null}
        isRunning={true}
        progress={null}
        errorMessage={null}
        isMarried={false}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    // The preparing state is now an animated shield mark. Its sr-only status
    // stands in for the old skeleton's accessible label, and the drawn shield
    // outline confirms the mark itself rendered.
    expect(
      getByText(
        /Solving the life-insurance need, year by year\. This can take a moment/i,
      ),
    ).toBeTruthy();
    expect(container.querySelector(".li-shield-outline")).toBeTruthy();
    expect(barProps()).toBeUndefined();
  });

  it("shows a clean 'no need' display when no year ever has a need", () => {
    const rows = [row(2026, 0, 0), row(2027, 0, 0)];

    const { getByText } = render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={false}
        progress={null}
        errorMessage={null}
        isMarried={true}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    expect(getByText(/No additional life insurance needed/i)).toBeTruthy();
    // No chart is drawn in the empty state.
    expect(barProps()).toBeUndefined();
  });

  it("keeps the progress bar visible alongside the chart while streaming", () => {
    const { getByRole } = render(
      <LiNeedOverTimeView
        rows={[row(2026, 500_000, null)]}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={true}
        progress={{ done: 1, total: 2 }}
        errorMessage={null}
        isMarried={false}
        clientName="Alex"
        spouseName="Jordan"
      />,
    );

    expect(getByRole("status")).toBeTruthy();
    expect(barProps()!.data.labels).toEqual(["2026", "2027"]);
  });
});
