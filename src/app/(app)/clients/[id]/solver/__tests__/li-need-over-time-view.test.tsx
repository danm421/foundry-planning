// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { NeedOverTimeRow } from "@/lib/life-insurance/need-over-time";

// Stub Chart.js's Bar so jsdom never touches <canvas>, and capture the props
// it was rendered with so we can assert on the labels/data the view builds.
vi.mock("react-chartjs-2", () => ({
  Bar: (props: {
    data: { labels: string[]; datasets: { label: string; data: (number | null)[] }[] };
  }) => {
    (globalThis as Record<string, unknown>).__barProps = props;
    return null;
  },
}));

import { LiNeedOverTimeView } from "../li-need-over-time-view";

function barProps() {
  return (globalThis as Record<string, unknown>).__barProps as {
    data: { labels: string[]; datasets: { label: string; data: (number | null)[] }[] };
  };
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__barProps;
});

describe("LiNeedOverTimeView — stable year axis", () => {
  it("renders the full plan-year axis mid-run, with only solved years populated", () => {
    // clientNeed is an exact $50k multiple so roundUpTo50k is the identity —
    // the assertion below can compare the raw value directly.
    const rows: NeedOverTimeRow[] = [
      {
        year: 2026,
        clientNeed: 1_000_000,
        spouseNeed: null,
        clientStatus: "solved",
        spouseStatus: null,
      },
    ];

    render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2028 }}
        isRunning={true}
        progress={{ done: 1, total: 3 }}
        errorMessage={null}
        isMarried={false}
        clientName="Client"
        spouseName="Spouse"
      />,
    );

    const props = barProps();
    // Axis spans every plan year, not just the one solved row.
    expect(props.data.labels).toEqual(["2026", "2027", "2028"]);
    // Solved year gets its rounded value; unsolved years render as `null`
    // gaps (Chart.js skips null points) rather than 0 or being omitted.
    expect(props.data.datasets[0].data).toEqual([1_000_000, null, null]);
  });

  it("keeps the progress bar visible alongside the chart while running", () => {
    const rows: NeedOverTimeRow[] = [
      {
        year: 2026,
        clientNeed: 500_000,
        spouseNeed: null,
        clientStatus: "solved",
        spouseStatus: null,
      },
    ];

    const { getByRole } = render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={true}
        progress={{ done: 1, total: 2 }}
        errorMessage={null}
        isMarried={false}
        clientName="Client"
        spouseName="Spouse"
      />,
    );

    // Progress bar (role="status") is present at the same time the chart
    // renders — the whole point is bars rising in place during the solve.
    expect(getByRole("status")).toBeTruthy();
    expect(barProps().data.labels).toEqual(["2026", "2027"]);
  });

  it("shows the preparing message before the year range is known", () => {
    const { getByText, queryByRole } = render(
      <LiNeedOverTimeView
        rows={null}
        yearRange={null}
        isRunning={true}
        progress={null}
        errorMessage={null}
        isMarried={false}
        clientName="Client"
        spouseName="Spouse"
      />,
    );

    expect(
      getByText("Preparing the life-insurance need-by-year solve…"),
    ).toBeTruthy();
    expect((globalThis as Record<string, unknown>).__barProps).toBeUndefined();
    expect(queryByRole("status")).toBeTruthy();
  });

  it("allows switching the client/spouse toggle mid-fill once yearRange is known", () => {
    const rows: NeedOverTimeRow[] = [
      {
        year: 2026,
        clientNeed: 1_000_000,
        spouseNeed: 500_000,
        clientStatus: "solved",
        spouseStatus: "solved",
      },
    ];

    const { getByRole } = render(
      <LiNeedOverTimeView
        rows={rows}
        yearRange={{ planStartYear: 2026, planEndYear: 2027 }}
        isRunning={true}
        progress={{ done: 1, total: 2 }}
        errorMessage={null}
        isMarried={true}
        clientName="Client"
        spouseName="Spouse"
      />,
    );

    // The decedent toggle is available even while the solve is still running.
    expect(getByRole("tab", { name: "Client dies" })).toBeTruthy();
    expect(getByRole("tab", { name: "Spouse dies" })).toBeTruthy();
  });
});
