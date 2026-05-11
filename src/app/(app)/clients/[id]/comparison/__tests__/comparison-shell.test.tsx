// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ComparisonShell } from "../comparison-shell";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string) => ({
    kind,
    title: kind,
    needsMc: false,
    render: () => <div data-widget={kind}>{kind}</div>,
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

vi.mock("../use-shared-mc-run", () => ({
  useSharedMcRun: () => ({ status: "idle" }),
}));

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const layout: ComparisonLayout = {
  version: 1,
  items: [
    { instanceId: id(1), kind: "portfolio", hidden: false, collapsed: false },
    { instanceId: id(2), kind: "estate-tax", hidden: false, collapsed: false },
  ],
};

const plans: ComparisonPlan[] = [
  { id: "base", index: 0, isBaseline: true, label: "Base", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "base", toggleState: {} } as never },
  { id: "a", index: 1, isBaseline: false, label: "A", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "a", toggleState: {} } as never },
];

describe("ComparisonShell", () => {
  it("renders the widgets in layout order in read mode", () => {
    const { container } = render(
      <ComparisonShell
        clientId="c"
        plans={plans}
        initialLayout={layout}
        customizing={false}
        onExitCustomize={vi.fn()}
      />,
    );
    const ws = container.querySelectorAll("[data-widget]");
    expect(ws).toHaveLength(2);
    expect(ws[0].getAttribute("data-widget")).toBe("portfolio");
  });

  it("shows toolbar in customize mode", () => {
    const { getByText } = render(
      <ComparisonShell
        clientId="c"
        plans={plans}
        initialLayout={layout}
        customizing
        onExitCustomize={vi.fn()}
      />,
    );
    expect(getByText("+ Add text block")).toBeTruthy();
  });

  it("preserves the no-second-plan empty state", () => {
    const { getByText } = render(
      <ComparisonShell
        clientId="c"
        plans={[plans[0]]}
        initialLayout={layout}
        customizing={false}
        onExitCustomize={vi.fn()}
      />,
    );
    expect(getByText("Pick a second plan to see the comparison.")).toBeTruthy();
  });
});
