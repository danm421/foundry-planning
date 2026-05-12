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
  WidgetPicker: ({ api }: { api: { addRow: () => { rowId: string; placeholderCellId: string }; addCell: (rowId: string, kind: string) => void; removeCell: (rowId: string, cellId: string) => void } }) => (
    <div aria-label="Widget picker">
      <button
        onClick={() => {
          const { rowId, placeholderCellId } = api.addRow();
          api.addCell(rowId, "portfolio");
          api.removeCell(rowId, placeholderCellId);
        }}
      >
        Add portfolio
      </button>
    </div>
  ),
}));

vi.mock("../widget-config-popover", () => ({
  WidgetConfigPopover: ({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) =>
    anchor === null ? null : (
      <div role="dialog" aria-label="Edit widget">
        <button onClick={onClose}>Close popover</button>
      </div>
    ),
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
    // Card title "portfolio" — exact match excludes the picker's "Add portfolio" button.
    expect(screen.getByText("portfolio")).toBeInTheDocument();
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

  it("renders the WidgetPicker rail always (no gear button)", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    expect(screen.getByLabelText(/Widget picker/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Open widget panel/i)).toBeNull();
  });

  it("clicking ✎ on a card opens the config popover anchored to it", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    fireEvent.click(screen.getByLabelText(/Edit widget/i));
    expect(screen.getByRole("dialog", { name: /edit widget/i })).toBeInTheDocument();
  });

  it("Save button is disabled until a change is made", () => {
    render(
      <ComparisonShell
        clientId="c"
        initialLayout={layout}
        scenarios={scenarios}
        primaryScenarioId="base"
      />,
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.click(screen.getByText(/add portfolio/i));
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
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
