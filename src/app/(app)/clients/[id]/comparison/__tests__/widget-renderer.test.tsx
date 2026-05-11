// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { WidgetRenderer } from "../widget-renderer";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

// Replace the registry with stubs so we don't accidentally render real widgets
vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string) => ({
    kind,
    title: kind,
    needsMc: false,
    render: ({ editing }: { editing: boolean }) => (
      <div data-widget={kind} data-editing={String(editing)}>{kind}</div>
    ),
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

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

describe("WidgetRenderer", () => {
  it("renders all widgets in layout order", () => {
    const layout: ComparisonLayout = {
      version: 3,
      yearRange: null,
      items: [
        { instanceId: id(1), kind: "portfolio" },
        { instanceId: id(2), kind: "estate-tax" },
      ],
    };
    const { container } = render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[] as ComparisonPlan[]}
        mc={null}
        yearRange={null}
        editing={false}
      />,
    );
    const widgets = container.querySelectorAll("[data-widget]");
    expect(widgets).toHaveLength(2);
    expect(widgets[0].getAttribute("data-widget")).toBe("portfolio");
    expect(widgets[1].getAttribute("data-widget")).toBe("estate-tax");
  });

  it("passes editing=true through to each widget when set", () => {
    const layout: ComparisonLayout = {
      version: 3,
      yearRange: null,
      items: [{ instanceId: id(1), kind: "portfolio" }],
    };
    const { container } = render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[]}
        mc={null}
        yearRange={null}
        editing={true}
      />,
    );
    expect(
      container.querySelector("[data-widget='portfolio']")?.getAttribute("data-editing"),
    ).toBe("true");
  });

  it("renders empty-state when the layout has zero items", () => {
    const layout: ComparisonLayout = { version: 3, yearRange: null, items: [] };
    const { container } = render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[]}
        mc={null}
        yearRange={null}
        editing={false}
      />,
    );
    expect(container.textContent).toContain("No widgets");
  });
});
