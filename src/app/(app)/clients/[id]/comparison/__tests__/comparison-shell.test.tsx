// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ComparisonShell } from "../comparison-shell";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const lastCtx: Record<string, unknown> = {};

vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string) => ({
    kind,
    title: kind,
    needsMc: false,
    render: (ctx: { yearRange: unknown; editing: boolean }) => {
      lastCtx[kind] = ctx;
      return <div data-widget={kind} data-editing={String(ctx.editing)}>{kind}</div>;
    },
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
      "income-expense": make("income-expense"),
      "withdrawal-source": make("withdrawal-source"),
      "year-by-year": make("year-by-year"),
    },
  };
});

vi.mock("../use-shared-mc-run", () => ({
  useSharedMcRun: () => ({ status: "idle" }),
}));

vi.mock("../widget-panel", () => ({
  WidgetPanel: ({ onDone }: { onDone: () => void }) => (
    <div data-testid="widget-panel">
      <button onClick={onDone}>Done</button>
    </div>
  ),
}));

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const layout: ComparisonLayout = {
  version: 3,
  yearRange: null,
  items: [
    { instanceId: id(1), kind: "portfolio" },
    { instanceId: id(2), kind: "estate-tax" },
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
        panelOpen={false}
        onClosePanel={vi.fn()}
        yearRange={null}
      />,
    );
    const ws = container.querySelectorAll("[data-widget]");
    expect(ws).toHaveLength(2);
    expect(ws[0].getAttribute("data-widget")).toBe("portfolio");
    expect(ws[0].getAttribute("data-editing")).toBe("false");
  });

  it("renders the panel and passes editing=true to widgets when panelOpen", () => {
    const { getByTestId, container } = render(
      <ComparisonShell
        clientId="c"
        plans={plans}
        initialLayout={layout}
        panelOpen
        onClosePanel={vi.fn()}
        yearRange={null}
      />,
    );
    expect(getByTestId("widget-panel")).toBeTruthy();
    expect(
      container.querySelector("[data-widget=portfolio]")?.getAttribute("data-editing"),
    ).toBe("true");
  });

  it("preserves the no-second-plan empty state", () => {
    const { getByText } = render(
      <ComparisonShell
        clientId="c"
        plans={[plans[0]]}
        initialLayout={layout}
        panelOpen={false}
        onClosePanel={vi.fn()}
        yearRange={null}
      />,
    );
    expect(getByText("Pick a second plan to see the comparison.")).toBeTruthy();
  });

  it("passes yearRange through to widget render contexts", () => {
    render(
      <ComparisonShell
        clientId="c"
        plans={plans}
        initialLayout={layout}
        panelOpen={false}
        onClosePanel={vi.fn()}
        yearRange={{ start: 2030, end: 2055 }}
      />,
    );
    expect(lastCtx.portfolio).toMatchObject({
      yearRange: { start: 2030, end: 2055 },
    });
  });
});
