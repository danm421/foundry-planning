// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WidgetPanel } from "../widget-panel";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";
import type { UseLayoutApi } from "../use-layout";

vi.mock("@/lib/comparison/widgets/registry", () => {
  const m = (kind: string, title: string, category: string, scenarios: string) => ({
    kind, title, category, scenarios, needsMc: false, render: () => null,
  });
  return {
    COMPARISON_WIDGETS: {
      kpi: m("kpi", "KPI", "kpis", "one"),
      "kpi-strip": m("kpi-strip", "KPI Strip (legacy)", "kpis", "one-or-many"),
      portfolio: m("portfolio", "Portfolio", "investments", "one-or-many"),
      "allocation-drift": m("allocation-drift", "Asset Allocation Drift", "investments", "one-or-many"),
      "monte-carlo": m("monte-carlo", "Monte Carlo Outcomes", "monte-carlo", "one-or-many"),
      longevity: m("longevity", "Longevity", "monte-carlo", "one-or-many"),
      "income-expense": m("income-expense", "Income & Expenses", "cashflow", "one-or-many"),
      "year-by-year": m("year-by-year", "Year-by-year", "cashflow", "many-only"),
      "tax-bracket-fill": m("tax-bracket-fill", "Bracket Fill", "tax", "one-or-many"),
      "ss-income": m("ss-income", "SS Income", "retirement-income", "one-or-many"),
      "estate-tax": m("estate-tax", "Estate Tax", "estate", "one-or-many"),
      text: m("text", "Text block", "text", "none"),
    },
  };
});

const layout: ComparisonLayoutV4 = {
  version: 4,
  title: "T",
  rows: [
    { id: "r1", cells: [{ id: "c1", widget: { id: "w1", kind: "portfolio", planIds: ["base"] } }] },
    { id: "r2", cells: [{ id: "c2", widget: { id: "w2", kind: "monte-carlo", planIds: ["base"] } }] },
  ],
};

function makeApi(): UseLayoutApi {
  return {
    layout,
    setTitle: vi.fn(),
    addRow: vi.fn(() => ({ rowId: "row-new", placeholderCellId: "placeholder-cell" })),
    removeRow: vi.fn(),
    moveRow: vi.fn(),
    addCell: vi.fn(),
    removeCell: vi.fn(),
    moveCell: vi.fn(),
    updateWidgetPlanIds: vi.fn(),
    updateWidgetYearRange: vi.fn(),
    updateWidgetConfig: vi.fn(),
    updateTextMarkdown: vi.fn(),
    reset: vi.fn(),
    save: vi.fn(async () => {}),
    saving: false,
  };
}

const scenarios = [{ id: "base", name: "Base" }, { id: "sc-1", name: "Roth Heavy" }];

describe("WidgetPanel (v4)", () => {
  it("Lists Layout entries by canvas order", () => {
    const { container } = render(
      <WidgetPanel
        api={makeApi()}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    const entries = container.querySelectorAll("[data-layout-entry]");
    expect(Array.from(entries).map((e) => e.getAttribute("data-layout-entry"))).toEqual([
      "c1", "c2",
    ]);
  });

  it("Groups Available widgets by category header", () => {
    render(
      <WidgetPanel
        api={makeApi()}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    // Target the category-header toggle buttons specifically; widget entry buttons
    // share the same role but have different names (never matching category titles
    // in the mock — see mock titles above).
    expect(screen.getByRole("button", { name: /KPIs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cash Flow$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Investments$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Monte Carlo$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retirement Income/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Tax$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Estate$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Text$/i })).toBeInTheDocument();
  });

  it("Available hides the legacy kpi-strip", () => {
    render(
      <WidgetPanel
        api={makeApi()}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    expect(screen.queryByText("KPI Strip (legacy)")).toBeNull();
  });

  it("Clicking an Available entry adds a new row containing that widget", () => {
    const api = makeApi();
    render(
      <WidgetPanel
        api={api}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Longevity"));
    expect(api.addRow).toHaveBeenCalled();
    expect(api.addCell).toHaveBeenCalledWith("row-new", "longevity");
    // The placeholder text cell on the new row needs removing — panel handles that:
    expect(api.removeCell).toHaveBeenCalled();
  });

  it("Clicking ✎ on a Layout entry expands the inline config below it", () => {
    render(
      <WidgetPanel
        api={makeApi()}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    const editBtns = screen.getAllByLabelText(/^Edit /i);
    fireEvent.click(editBtns[0]);
    // ScenarioChipPicker should now appear (scenarios are clickable chips with the name).
    expect(screen.getByText("Base")).toBeInTheDocument();
  });

  it("Clicking 🗑 on a Layout entry calls removeCell with row+cell ids", () => {
    const api = makeApi();
    render(
      <WidgetPanel
        api={api}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    const removeBtns = screen.getAllByLabelText(/^Remove /i);
    fireEvent.click(removeBtns[0]);
    expect(api.removeCell).toHaveBeenCalledWith("r1", "c1");
  });

  it("Done button calls api.save then onDone", async () => {
    const api = makeApi();
    const onDone = vi.fn();
    render(
      <WidgetPanel
        api={api}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByText("Done"));
    // save is async; wait a microtask:
    await Promise.resolve();
    expect(api.save).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("Reset button asks for confirmation, then calls api.reset with primary id", () => {
    const api = makeApi();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <WidgetPanel
        api={api}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/Reset to default/i));
    expect(api.reset).toHaveBeenCalledWith("base");
    confirmSpy.mockRestore();
  });

  it("Reset button is a no-op when confirm is cancelled", () => {
    const api = makeApi();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <WidgetPanel
        api={api}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2065 }}
        primaryScenarioId="base"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/Reset to default/i));
    expect(api.reset).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
