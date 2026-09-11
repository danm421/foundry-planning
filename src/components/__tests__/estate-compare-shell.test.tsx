// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
