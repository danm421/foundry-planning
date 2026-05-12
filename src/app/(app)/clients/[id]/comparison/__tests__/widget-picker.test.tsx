// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WidgetPicker } from "../widget-picker";
import type { UseLayoutApi } from "../use-layout";

vi.mock("@/lib/comparison/widgets/registry", () => {
  const m = (kind: string, title: string, category: string) => ({
    kind, title, category, scenarios: "one-or-many", needsMc: false, render: () => null,
  });
  return {
    COMPARISON_WIDGETS: {
      kpi: m("kpi", "KPI", "kpis"),
      "kpi-strip": m("kpi-strip", "KPI Strip (legacy)", "kpis"),
      portfolio: m("portfolio", "Portfolio", "investments"),
      "allocation-drift": m("allocation-drift", "Allocation Drift", "investments"),
      "monte-carlo": m("monte-carlo", "Monte Carlo", "monte-carlo"),
      longevity: m("longevity", "Longevity", "monte-carlo"),
      "tax-bracket-fill": m("tax-bracket-fill", "Bracket Fill", "tax"),
    },
  };
});

function makeApi(): UseLayoutApi {
  return {
    layout: { version: 4, title: "T", rows: [] },
    setTitle: vi.fn(),
    addRow: vi.fn(() => ({ rowId: "row-new", placeholderCellId: "ph" })),
    removeRow: vi.fn(),
    moveRow: vi.fn(),
    addCell: vi.fn(),
    removeCell: vi.fn(),
    moveCell: vi.fn(),
    duplicateCell: vi.fn(),
    updateWidgetPlanIds: vi.fn(),
    updateWidgetYearRange: vi.fn(),
    updateWidgetConfig: vi.fn(),
    updateTextMarkdown: vi.fn(),
    reset: vi.fn(),
    save: vi.fn(async () => {}),
    saving: false,
    dirty: false,
  };
}

describe("WidgetPicker", () => {
  it("shows tabs for every category in CATEGORY_ORDER", () => {
    render(<WidgetPicker api={makeApi()} primaryScenarioId="base" />);
    expect(screen.getByRole("tab", { name: /KPIs/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Investments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Monte Carlo/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Tax$/i })).toBeInTheDocument();
  });

  it("body shows only widgets in the active tab when search is empty", () => {
    const { container } = render(<WidgetPicker api={makeApi()} primaryScenarioId="base" />);
    fireEvent.click(screen.getByRole("tab", { name: /Investments/i }));
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("Allocation Drift")).toBeInTheDocument();
    const visibleKinds = Array.from(
      container.querySelectorAll("[data-available-kind]"),
    ).map((el) => el.getAttribute("data-available-kind"));
    expect(visibleKinds).not.toContain("monte-carlo");
    expect(visibleKinds).not.toContain("longevity");
  });

  it("hides kpi-strip from all lists", () => {
    render(<WidgetPicker api={makeApi()} primaryScenarioId="base" />);
    expect(screen.queryByText("KPI Strip (legacy)")).toBeNull();
  });

  it("typing in search flattens results across categories", () => {
    render(<WidgetPicker api={makeApi()} primaryScenarioId="base" />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "long" } });
    expect(screen.getByText("Longevity")).toBeInTheDocument();
    expect(screen.queryByText("Portfolio")).toBeNull();
  });

  it("non-empty search marks the tab bar aria-disabled", () => {
    render(<WidgetPicker api={makeApi()} primaryScenarioId="base" />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "long" } });
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-disabled", "true");
  });

  it("clicking an entry adds a new row at the bottom with that widget kind", () => {
    const api = makeApi();
    render(<WidgetPicker api={api} primaryScenarioId="base" />);
    fireEvent.click(screen.getByRole("tab", { name: /Monte Carlo/i }));
    fireEvent.click(screen.getByText("Longevity"));
    expect(api.addRow).toHaveBeenCalled();
    expect(api.addCell).toHaveBeenCalledWith("row-new", "longevity");
    expect(api.removeCell).toHaveBeenCalledWith("row-new", "ph");
  });

  it("entry can be clicked multiple times to add multiple instances", () => {
    const api = makeApi();
    render(<WidgetPicker api={api} primaryScenarioId="base" />);
    fireEvent.click(screen.getByRole("tab", { name: /Monte Carlo/i }));
    fireEvent.click(screen.getByText("Longevity"));
    fireEvent.click(screen.getByText("Longevity"));
    expect(api.addRow).toHaveBeenCalledTimes(2);
  });

  it("Reset asks for confirmation and calls api.reset on yes", () => {
    const api = makeApi();
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WidgetPicker api={api} primaryScenarioId="base" />);
    fireEvent.click(screen.getByText(/Reset to default/i));
    expect(api.reset).toHaveBeenCalledWith("base");
    spy.mockRestore();
  });
});
