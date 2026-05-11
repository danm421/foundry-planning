// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Stub the sortable internals so we just verify the wiring contract.
vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/sortable")>(
    "@dnd-kit/sortable",
  );
  return {
    ...actual,
    SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => (
      <div data-sortable-ids={items.join(",")}>{children}</div>
    ),
    useSortable: () => ({
      setNodeRef: () => {},
      attributes: {},
      listeners: {},
      transform: null,
      transition: undefined,
    }),
  };
});

import { ComparisonShell } from "../comparison-shell";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => ({
  COMPARISON_WIDGETS: {
    "kpi-strip": { kind: "kpi-strip", title: "k", needsMc: false, render: () => null },
    portfolio: { kind: "portfolio", title: "p", needsMc: false, render: () => null },
    "monte-carlo": { kind: "monte-carlo", title: "m", needsMc: false, render: () => null },
    longevity: { kind: "longevity", title: "l", needsMc: false, render: () => null },
    "lifetime-tax": { kind: "lifetime-tax", title: "lt", needsMc: false, render: () => null },
    liquidity: { kind: "liquidity", title: "lq", needsMc: false, render: () => null },
    "estate-impact": { kind: "estate-impact", title: "ei", needsMc: false, render: () => null },
    "estate-tax": { kind: "estate-tax", title: "et", needsMc: false, render: () => null },
    text: { kind: "text", title: "t", needsMc: false, render: () => null },
  },
}));
vi.mock("../use-shared-mc-run", () => ({ useSharedMcRun: () => ({ status: "idle" }) }));

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const layout: ComparisonLayout = {
  version: 1,
  items: [
    { instanceId: id(1), kind: "portfolio", hidden: false, collapsed: false },
    { instanceId: id(2), kind: "estate-tax", hidden: false, collapsed: false },
  ],
};

const plans = [
  { id: "base", index: 0, isBaseline: true, label: "B", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "base", toggleState: {} } as never },
  { id: "a", index: 1, isBaseline: false, label: "A", tree: {} as never, result: { years: [] } as never, lifetime: {} as never, liquidityRows: [], finalEstate: null, panelData: null, ref: { kind: "scenario", id: "a", toggleState: {} } as never },
];

describe("ComparisonShell DnD wiring", () => {
  it("exposes a SortableContext with widget instanceIds in customize mode", () => {
    const { container } = render(
      <ComparisonShell
        clientId="c"
        plans={plans as never}
        initialLayout={layout}
        customizing
        onExitCustomize={vi.fn()}
      />,
    );
    const ctx = container.querySelector("[data-sortable-ids]");
    expect(ctx?.getAttribute("data-sortable-ids")).toBe(`${id(1)},${id(2)}`);
  });
});
