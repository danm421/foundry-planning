// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ComparisonShell } from "../comparison-shell";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => {
  const m = (kind: string, category = "investments") => ({
    kind, title: kind, category, scenarios: "one-or-many", needsMc: false,
    render: ({ plans }: { plans: { id: string }[] }) => (
      <div data-widget={kind}>{kind} ({plans.map((p) => p.id).join(",")})</div>
    ),
  });
  return {
    COMPARISON_WIDGETS: {
      portfolio: m("portfolio"),
      "monte-carlo": { ...m("monte-carlo", "monte-carlo"), needsMc: true },
      kpi: { ...m("kpi", "kpis"), scenarios: "one", needsMc: true },
      text: m("text", "text"),
    },
  };
});

vi.mock("../use-shared-mc-run", () => ({
  useSharedMcRun: () => ({ status: "idle" }),
}));

vi.mock("../use-preview-plans", () => {
  return {
    usePreviewPlans: ({ enabled, planIds }: { enabled: boolean; planIds: string[] }) => {
      if (!enabled) return { status: "idle" };
      return {
        status: "ready",
        plans: planIds.map((id) => ({ id, label: id, result: { years: [] } })),
      };
    },
  };
});

vi.mock("../widget-picker", () => ({
  WidgetPanel: () => <div data-testid="widget-panel" />,
}));

const layout: ComparisonLayoutV4 = {
  version: 4,
  title: "T",
  rows: [
    { id: "r1", cells: [{ id: "c1", widget: { id: "w1", kind: "portfolio", planIds: ["base"] } }] },
  ],
};

const scenarios = [{ id: "base", name: "Base" }];

describe("ComparisonShell (v4)", () => {
  it("renders Layout-mode WidgetCard (no widget render) by default", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    expect(screen.queryByText(/portfolio \(base\)/)).toBeNull();
    expect(screen.getByText(/portfolio/i)).toBeInTheDocument(); // card title
  });

  it("switches to Preview-mode rendering and binds planIds", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    fireEvent.click(screen.getByText(/preview/i));
    expect(screen.getByText(/portfolio \(base\)/)).toBeInTheDocument();
  });

  it("opens the WidgetPanel on gear click", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    fireEvent.click(screen.getByLabelText(/Open widget panel/i));
    expect(screen.getByTestId("widget-panel")).toBeInTheDocument();
  });

  it("renders the report title and updates on input", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    const input = screen.getByLabelText(/Report title/i) as HTMLInputElement;
    expect(input.value).toBe("T");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect((screen.getByLabelText(/Report title/i) as HTMLInputElement).value).toBe("Renamed");
  });
});
