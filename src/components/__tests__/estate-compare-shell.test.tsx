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

function renderShell() {
  return render(
    <EstateCompareShell<string>
      clientId="c1"
      scenarios={SCENARIOS}
      isMarried
      ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
      ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
      retirementYear={2030}
    >
      {(args) => <StubColumn {...args} />}
    </EstateCompareShell>,
  );
}

/** Both columns mounted, with Last Death landing on DIFFERENT years per side. */
function renderDivergingShell() {
  return render(
    <EstateCompareShell<string>
      clientId="c1"
      scenarios={SCENARIOS}
      isMarried
      ownerNames={{ clientName: "Robert", spouseName: "Anita" }}
      ownerDobs={{ clientDob: "1960-01-01", spouseDob: "1962-01-01" }}
      retirementYear={2030}
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

beforeEach(() => {
  push.mockClear();
  search = "";
});

describe("EstateCompareShell", () => {
  it("renders a single column when ?compare= is absent", () => {
    renderShell();
    expect(screen.getByTestId("col-left")).toBeInTheDocument();
    expect(screen.queryByTestId("col-right")).not.toBeInTheDocument();
  });

  it("offers a control to start comparing when solo", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /compare to/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /compare to/i }));
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
});
