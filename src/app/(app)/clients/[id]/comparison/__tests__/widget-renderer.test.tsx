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
    render: ({ collapsed }: { collapsed: boolean }) =>
      collapsed ? <div data-widget={kind}>collapsed</div> : <div data-widget={kind}>visible</div>,
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

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

describe("WidgetRenderer", () => {
  it("renders all non-hidden widgets in layout order", () => {
    const layout: ComparisonLayout = {
      version: 1,
      items: [
        { instanceId: id(1), kind: "portfolio", hidden: false, collapsed: false },
        { instanceId: id(2), kind: "estate-tax", hidden: false, collapsed: false },
      ],
    };
    const { container } = render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[] as ComparisonPlan[]}
        mc={null}
      />,
    );
    const widgets = container.querySelectorAll("[data-widget]");
    expect(widgets).toHaveLength(2);
    expect(widgets[0].getAttribute("data-widget")).toBe("portfolio");
    expect(widgets[1].getAttribute("data-widget")).toBe("estate-tax");
  });

  it("skips hidden widgets", () => {
    const layout: ComparisonLayout = {
      version: 1,
      items: [
        { instanceId: id(1), kind: "portfolio", hidden: true, collapsed: false },
        { instanceId: id(2), kind: "estate-tax", hidden: false, collapsed: false },
      ],
    };
    const { container } = render(
      <WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />,
    );
    expect(container.querySelectorAll("[data-widget]")).toHaveLength(1);
  });

  it("forwards collapsed=true to the widget render fn", () => {
    const layout: ComparisonLayout = {
      version: 1,
      items: [
        { instanceId: id(1), kind: "portfolio", hidden: false, collapsed: true },
      ],
    };
    const { container } = render(
      <WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />,
    );
    expect(container.querySelector("[data-widget='portfolio']")?.textContent).toBe(
      "collapsed",
    );
  });

  it("renders empty-state when nothing is visible", () => {
    const layout: ComparisonLayout = { version: 1, items: [] };
    const { container } = render(
      <WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />,
    );
    expect(container.textContent).toContain("No widgets visible");
  });
});
