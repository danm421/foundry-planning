// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WidgetConfigPanel } from "../widget-config-panel";
import type { WidgetInstance } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => ({
  COMPARISON_WIDGETS: {
    kpi: {
      kind: "kpi", title: "KPI", category: "kpis",
      scenarios: "one", needsMc: true, render: () => null,
      renderConfig: ({ onChange }: { onChange: (c: unknown) => void }) => (
        <button onClick={() => onChange({ metric: "lifetimeTax" })}>set-metric</button>
      ),
    },
    portfolio: {
      kind: "portfolio", title: "Portfolio Assets", category: "investments",
      scenarios: "one-or-many", needsMc: false, render: () => null,
    },
    text: {
      kind: "text", title: "Text", category: "text",
      scenarios: "none", needsMc: false, render: () => null,
    },
  },
}));

const w = (kind: string, planIds: string[]): WidgetInstance =>
  ({ id: "w", kind, planIds } as unknown as WidgetInstance);

describe("WidgetConfigPanel", () => {
  const scenarios = [{ id: "base", name: "Base" }, { id: "sc-1", name: "Roth Heavy" }];

  it("renders scenario picker + year range + widget-specific config", () => {
    render(
      <WidgetConfigPanel
        widget={w("kpi", ["base"])}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        onChangePlanIds={vi.fn()}
        onChangeYearRange={vi.fn()}
        onChangeConfig={vi.fn()}
      />,
    );
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByLabelText(/Start/i)).toBeInTheDocument();
    expect(screen.getByText("set-metric")).toBeInTheDocument();
  });

  it("hides scenario picker for 'none' widgets", () => {
    render(
      <WidgetConfigPanel
        widget={w("text", [])}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        onChangePlanIds={vi.fn()}
        onChangeYearRange={vi.fn()}
        onChangeConfig={vi.fn()}
      />,
    );
    expect(screen.queryByText("Base")).toBeNull();
  });

  it("invokes onChangeConfig when widget-specific config fires", () => {
    const onChangeConfig = vi.fn();
    render(
      <WidgetConfigPanel
        widget={w("kpi", ["base"])}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        onChangePlanIds={vi.fn()}
        onChangeYearRange={vi.fn()}
        onChangeConfig={onChangeConfig}
      />,
    );
    fireEvent.click(screen.getByText("set-metric"));
    expect(onChangeConfig).toHaveBeenCalledWith({ metric: "lifetimeTax" });
  });
});
