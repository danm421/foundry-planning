// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetRenderer } from "../widget-renderer";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const lastCtx: Record<string, { planIds: string[]; yearRange: unknown }> = {};

vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string) => ({
    kind, title: kind, needsMc: false,
    category: "investments", scenarios: "one-or-many",
    render: (ctx: { plans: ComparisonPlan[]; yearRange: unknown }) => {
      lastCtx[kind] = {
        planIds: ctx.plans.map((p) => p.id),
        yearRange: ctx.yearRange,
      };
      return <div data-widget={kind}>{kind} ({ctx.plans.map((p) => p.id).join(",")})</div>;
    },
  });
  return {
    COMPARISON_WIDGETS: {
      portfolio: make("portfolio"),
      "monte-carlo": make("monte-carlo"),
      longevity: make("longevity"),
      text: { ...make("text"), scenarios: "none" },
    },
  };
});

const plan = (id: string): ComparisonPlan =>
  ({ id, label: id, result: { years: [] } } as unknown as ComparisonPlan);

beforeEach(() => {
  for (const key in lastCtx) delete lastCtx[key];
});

describe("WidgetRenderer (v4)", () => {
  it("renders rows of cells in order", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        { id: "r1", cells: [{ id: "c1", widget: { id: "w1", kind: "portfolio", planIds: ["base"] } }] },
        {
          id: "r2",
          cells: [
            { id: "c2", widget: { id: "w2", kind: "monte-carlo", planIds: ["base", "sc-1"] } },
            { id: "c3", widget: { id: "w3", kind: "longevity", planIds: ["sc-1"] } },
          ],
        },
      ],
    };
    render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[plan("base"), plan("sc-1")]}
        mc={null}
      />,
    );
    expect(screen.getByText(/portfolio \(base\)/i)).toBeInTheDocument();
    expect(screen.getByText(/monte-carlo \(base,sc-1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/longevity \(sc-1\)/i)).toBeInTheDocument();
  });

  it("filters plans by per-widget planIds (in declared order)", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "r1",
          cells: [
            { id: "c1", widget: { id: "w1", kind: "portfolio", planIds: ["sc-1", "base"] } },
          ],
        },
      ],
    };
    render(
      <WidgetRenderer
        layout={layout}
        clientId="c"
        plans={[plan("base"), plan("sc-1")]}
        mc={null}
      />,
    );
    expect(lastCtx.portfolio.planIds).toEqual(["sc-1", "base"]);
  });

  it("passes per-widget yearRange into ctx", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "r1",
          cells: [
            {
              id: "c1",
              widget: {
                id: "w1", kind: "portfolio", planIds: ["base"],
                yearRange: { start: 2030, end: 2055 },
              },
            },
          ],
        },
      ],
    };
    render(<WidgetRenderer layout={layout} clientId="c" plans={[plan("base")]} mc={null} />);
    expect(lastCtx.portfolio.yearRange).toEqual({ start: 2030, end: 2055 });
  });

  it("text widget renders even when there are no plans", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "r1",
          cells: [
            { id: "c1", widget: { id: "w1", kind: "text", planIds: [], config: { markdown: "hi" } } },
          ],
        },
      ],
    };
    render(<WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />);
    expect(screen.getByText("text ()")).toBeInTheDocument();
  });

  it("renders empty-state when layout has no rows", () => {
    const layout: ComparisonLayoutV4 = { version: 4, title: "T", rows: [] };
    const { container } = render(
      <WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />,
    );
    expect(container.textContent).toContain("No widgets");
  });

  it("renders an Unknown widget placeholder when kind is not in the registry", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "r1",
          cells: [
            {
              id: "c1",
              // @ts-expect-error — intentionally unknown kind to exercise the guard
              widget: { id: "w1", kind: "made-up-kind", planIds: [] },
            },
          ],
        },
      ],
    };
    render(<WidgetRenderer layout={layout} clientId="c" plans={[]} mc={null} />);
    expect(screen.getByText(/Unknown widget: made-up-kind/i)).toBeInTheDocument();
  });
});
