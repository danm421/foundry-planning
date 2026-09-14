// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect } from "react";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/clients/c1/estate-planning/estate-tax",
  useSearchParams: () => new URLSearchParams(search),
}));

import { EstateCompareShell } from "@/components/estate-compare-shell";
import type { CompareAsOf } from "@/lib/estate/compare-ref";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

const SCENARIOS: ScenarioOption[] = [
  { id: "s-base", name: "Base Facts", isBaseCase: true },
  { id: "s-prop", name: "Proposed Plan", isBaseCase: false },
];

const META = {
  years: [2026, 2027],
  todayYear: 2026,
  firstDeathYear: 2060,
  secondDeathYear: 2061,
};

/** Stand-in for a report view: reports ready on mount, prints what it got. */
function StubColumn({
  side,
  scenarioRef,
  asOf,
  baseline,
  onReady,
  meta = META,
}: {
  side: string;
  scenarioRef: string;
  asOf: string | number;
  baseline: string | null;
  onReady: (r: { meta: typeof META; data: string | null }) => void;
  meta?: typeof META;
}) {
  useEffect(() => {
    onReady({ meta, data: `data-for-${scenarioRef}` });
  }, [onReady, scenarioRef, meta]);
  return (
    <div
      data-testid={`col-${side}`}
      data-ref={scenarioRef}
      data-asof={String(asOf)}
      data-baseline={baseline ?? ""}
    />
  );
}

type ShellProps = { soloFullWidth?: boolean; initialAsOf?: CompareAsOf };

function renderShell(props: ShellProps = {}) {
  return render(
    <EstateCompareShell<string>
      clientId="c1"
      scenarios={SCENARIOS}
      isMarried
      ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
      ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
      retirementYear={2030}
      {...props}
    >
      {(args) => <StubColumn {...args} />}
    </EstateCompareShell>,
  );
}

/** Both columns mounted, with Last Death landing on DIFFERENT years per side. */
function renderDivergingShell(props: ShellProps = {}) {
  return render(
    <EstateCompareShell<string>
      clientId="c1"
      scenarios={SCENARIOS}
      isMarried
      ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
      ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
      retirementYear={2030}
      {...props}
    >
      {(args) => (
        <StubColumn
          {...args}
          meta={
            args.side === "left"
              ? { ...META, secondDeathYear: 2061 }
              : { ...META, secondDeathYear: 2059 }
          }
        />
      )}
    </EstateCompareShell>,
  );
}

/** Reports like a real view, except a ref that is still fetching stays silent. */
function PendingAwareColumn({
  side,
  scenarioRef,
  baseline,
  onReady,
}: {
  side: string;
  scenarioRef: string;
  baseline: string | null;
  onReady: (r: { meta: typeof META; data: string | null }) => void;
}) {
  useEffect(() => {
    if (scenarioRef === "s-loading") return;
    onReady({ meta: META, data: `data-for-${scenarioRef}` });
  }, [onReady, scenarioRef]);
  return (
    <div
      data-testid={`col-${side}`}
      data-ref={scenarioRef}
      data-baseline={baseline ?? ""}
    />
  );
}

/** Records one call per MOUNT, so a remount is visible as a second call. */
const mountSpy = vi.fn();
function MountCountingColumn({
  side,
  scenarioRef,
  onReady,
}: {
  side: string;
  scenarioRef: string;
  onReady: (r: { meta: typeof META; data: string | null }) => void;
}) {
  useEffect(() => {
    mountSpy(side);
  }, [side]);
  useEffect(() => {
    onReady({ meta: META, data: `data-for-${scenarioRef}` });
  }, [onReady, scenarioRef]);
  return <div data-testid={`col-${side}`} data-ref={scenarioRef} />;
}

beforeEach(() => {
  push.mockClear();
  mountSpy.mockClear();
  search = "";
});

describe("EstateCompareShell", () => {
  it("renders a single column when ?compare= is absent", () => {
    renderShell();
    expect(screen.getByTestId("col-left")).toBeInTheDocument();
    expect(screen.queryByTestId("col-right")).not.toBeInTheDocument();
  });

  // Spec decision 1 makes the empty right half the affordance that tells an
  // advisor a comparison exists, so half width stays the DEFAULT. One report
  // (State Death Tax, whose narrowest table measured 672px against the 597px
  // half a 1440px viewport gives it) opts out; the idiom itself stands.
  it("gives a solo column half the row by default", () => {
    renderShell();
    expect(screen.getByTestId("estate-compare-columns")).toHaveClass("md:w-1/2");
  });

  it("lets a report opt out and take the whole row when solo", () => {
    renderShell({ soloFullWidth: true });
    const columns = screen.getByTestId("estate-compare-columns");
    expect(columns).toHaveClass("w-full");
    expect(columns).not.toHaveClass("md:w-1/2");
  });

  it("ignores the solo width in compare mode — two columns either way", () => {
    search = "compare=s-prop";
    renderShell({ soloFullWidth: true });
    const columns = screen.getByTestId("estate-compare-columns");
    expect(columns).toHaveClass("md:grid-cols-2");
    expect(columns).not.toHaveClass("w-full");
  });

  it("offers a control to start comparing when solo", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeInTheDocument();
  });

  it("renders both columns when ?compare= is set", () => {
    search = "scenario=s-prop&compare=base";
    renderShell();
    expect(screen.getByTestId("col-left")).toHaveAttribute("data-ref", "s-prop");
    expect(screen.getByTestId("col-right")).toHaveAttribute("data-ref", "base");
  });

  it("hands the left column's data to the right column as its baseline", async () => {
    search = "scenario=s-prop&compare=base";
    renderShell();
    expect(await screen.findByTestId("col-right")).toHaveAttribute(
      "data-baseline",
      "data-for-s-prop",
    );
  });

  it("never hands the left column a baseline", () => {
    search = "scenario=s-prop&compare=base";
    renderShell();
    expect(screen.getByTestId("col-left")).toHaveAttribute("data-baseline", "");
  });

  it("renders the shared control row once, not once per column", async () => {
    search = "scenario=s-prop&compare=base";
    renderShell();
    expect(await screen.findAllByRole("group", { name: /death order/i })).toHaveLength(1);
  });

  it("falls back to solo and explains itself when handed a snapshot ref", () => {
    search = "compare=snap:abc";
    renderShell();
    expect(screen.queryByTestId("col-right")).not.toBeInTheDocument();
    expect(screen.getByText(/snapshots can't be compared/i)).toBeInTheDocument();
  });

  it("falls back to solo when ?compare= names a scenario that no longer exists", () => {
    search = "compare=s-deleted";
    renderShell();
    expect(screen.queryByTestId("col-right")).not.toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });

  it("resolves Last Death to each column's OWN year", async () => {
    search = "scenario=s-prop&compare=base";
    render(
      <EstateCompareShell<string>
        clientId="c1"
        scenarios={SCENARIOS}
        isMarried
        ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
        ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
        retirementYear={2030}
        initialAsOf={{ kind: "milestone", milestone: "lastDeath" }}
      >
        {(args) => (
          <StubColumn
            {...args}
            meta={
              args.side === "left"
                ? { ...META, secondDeathYear: 2061 }
                : { ...META, secondDeathYear: 2059 }
            }
          />
        )}
      </EstateCompareShell>,
    );
    expect(await screen.findByTestId("col-left")).toHaveAttribute("data-asof", "2061");
    expect(await screen.findByTestId("col-right")).toHaveAttribute("data-asof", "2059");
  });

  // Each column resolves the milestone to its OWN year, so the header has to
  // name the milestone from the shared selection and take the number from the
  // column. Printing `String(asOf)` reads "2061" where it means the last death.
  it("names the milestone beside each column's own year", async () => {
    search = "scenario=s-prop&compare=base";
    renderDivergingShell({
      initialAsOf: { kind: "milestone", milestone: "lastDeath" },
    });
    // Title Case matches the pill row and the As-of options in the same bar.
    expect(await screen.findByText("Last Death · 2061")).toBeInTheDocument();
    expect(screen.getByText("Last Death · 2059")).toBeInTheDocument();
  });

  // Non-vacuity: without this the test above passes on a header that prefixes
  // EVERYTHING. A year the advisor typed is just a year.
  it("leaves a hand-picked year bare", async () => {
    search = "scenario=s-prop&compare=base";
    renderShell({ initialAsOf: { kind: "year", year: 2042 } });
    expect(await screen.findAllByText("2042")).toHaveLength(2);
    expect(screen.queryByText(/· 2042/)).not.toBeInTheDocument();
  });

  // The pill reports the LEFT column's year (2061). Storing that bare year
  // would pin both columns to 2061; only storing the milestone lets the right
  // column resolve its own 2059.
  it("stores the milestone, not the year, when the Last Death pill is clicked", async () => {
    search = "scenario=s-prop&compare=base";
    renderDivergingShell();
    fireEvent.click(screen.getByRole("button", { name: "Last Death" }));
    expect(await screen.findByTestId("col-left")).toHaveAttribute("data-asof", "2061");
    expect(await screen.findByTestId("col-right")).toHaveAttribute("data-asof", "2059");
  });

  it("stores the milestone, not the year, when As of selects that milestone", async () => {
    search = "scenario=s-prop&compare=base";
    renderDivergingShell();
    fireEvent.change(screen.getByRole("combobox", { name: "As of" }), {
      target: { value: "2061" },
    });
    expect(await screen.findByTestId("col-left")).toHaveAttribute("data-asof", "2061");
    expect(await screen.findByTestId("col-right")).toHaveAttribute("data-asof", "2059");
  });

  it("preserves other params when comparing starts, and clears only compare on dismiss", () => {
    search = "scenario=s-prop&tab=detail";
    const solo = renderShell();
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    const started = String(push.mock.calls[0][0]);
    expect(started).toContain("scenario=s-prop");
    expect(started).toContain("tab=detail");
    expect(started).toContain("compare=base");
    solo.unmount();

    push.mockClear();
    search = "scenario=s-prop&tab=detail&compare=base";
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /stop comparing/i }));
    const dismissed = String(push.mock.calls[0][0]);
    expect(dismissed).not.toContain("compare");
    expect(dismissed).toContain("scenario=s-prop");
    expect(dismissed).toContain("tab=detail");
  });

  // The shell survives a ?scenario= change without unmounting, so a reading
  // describing the PREVIOUS left scenario must not be read as the new one's.
  // Otherwise the right column keeps rendering deltas against the old
  // scenario for the whole of the new one's fetch — a wrong number on screen.
  it("drops the previous left scenario's baseline while the new one is still loading", () => {
    search = "scenario=s-prop&compare=base";
    const tree = () => (
      <EstateCompareShell<string>
        clientId="c1"
        scenarios={SCENARIOS}
        isMarried
        ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
        ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
        retirementYear={2030}
      >
        {(args) => <PendingAwareColumn {...args} />}
      </EstateCompareShell>
    );
    const { rerender } = render(tree());
    expect(screen.getByTestId("col-right")).toHaveAttribute(
      "data-baseline",
      "data-for-s-prop",
    );

    search = "scenario=s-loading&compare=base";
    rerender(tree());
    expect(screen.getByTestId("col-left")).toHaveAttribute("data-ref", "s-loading");
    expect(screen.getByTestId("col-right")).toHaveAttribute("data-baseline", "");
  });

  // React reconciles by position and element type. If the solo layout puts the
  // left column's <section> at a slot the compare layout fills with a <div>,
  // starting a comparison unmounts the whole left column and mounts a fresh
  // one — its state resets and its load effect re-runs, so the advisor pays a
  // second fetch of a scenario that was already on screen. That is the exact
  // waste the views' ref-keyed load effect exists to prevent.
  it("keeps the left column mounted when a comparison starts", () => {
    search = "scenario=s-prop";
    const tree = () => (
      <EstateCompareShell<string>
        clientId="c1"
        scenarios={SCENARIOS}
        isMarried
        ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
        ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
        retirementYear={2030}
      >
        {(args) => <MountCountingColumn {...args} />}
      </EstateCompareShell>
    );
    const { rerender } = render(tree());
    expect(screen.queryByTestId("col-right")).not.toBeInTheDocument();
    expect(mountSpy.mock.calls.filter(([s]) => s === "left")).toHaveLength(1);

    search = "scenario=s-prop&compare=base";
    rerender(tree());
    // The right column really did arrive — without this the assertion below
    // would pass on a shell that never entered compare mode at all.
    expect(screen.getByTestId("col-right")).toBeInTheDocument();
    expect(mountSpy.mock.calls.filter(([s]) => s === "left")).toHaveLength(1);
  });
});
