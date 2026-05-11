// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ComparisonShell } from "../comparison-shell";
import { getDefaultLayout } from "@/lib/comparison/widgets/default-layout";

// Tag stubs so we can read the order without rendering full widgets.
vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string) => ({
    kind,
    title: kind,
    needsMc: false,
    render: () => <div data-kind={kind} />,
  });
  return {
    COMPARISON_WIDGETS: {
      "kpi-strip": make("kpi-strip"),
      portfolio: make("portfolio"),
      "monte-carlo": make("monte-carlo"),
      longevity: make("longevity"),
      "lifetime-tax": make("lifetime-tax"),
      liquidity: make("liquidity"),
      "estate-impact": make("estate-impact"),
      "estate-tax": make("estate-tax"),
      text: make("text"),
    },
  };
});
vi.mock("../use-shared-mc-run", () => ({ useSharedMcRun: () => ({ status: "idle" }) }));

describe("Comparison page parity", () => {
  it("default layout renders Phase-1 widget order", () => {
    const plans = [
      { id: "base", index: 0, isBaseline: true, label: "Base", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "base", toggleState: {} } as never },
      { id: "a", index: 1, isBaseline: false, label: "A", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "a", toggleState: {} } as never },
    ];

    const { container } = render(
      <ComparisonShell
        clientId="c"
        plans={plans as never}
        initialLayout={getDefaultLayout()}
        customizing={false}
        onExitCustomize={() => {}}
      />,
    );

    const kinds = Array.from(container.querySelectorAll("[data-kind]")).map((n) =>
      n.getAttribute("data-kind"),
    );
    expect(kinds).toEqual([
      "kpi-strip",
      "portfolio",
      "monte-carlo",
      "longevity",
      "lifetime-tax",
      "liquidity",
      "estate-impact",
      "estate-tax",
    ]);
  });
});
