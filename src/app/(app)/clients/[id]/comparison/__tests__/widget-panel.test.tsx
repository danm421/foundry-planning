// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WidgetPanel } from "../widget-panel";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { UseLayoutApi } from "../use-layout";

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

function makeLayout(): ComparisonLayout {
  return {
    version: 3,
    yearRange: null,
    items: [
      { instanceId: id(1), kind: "portfolio" },
      { instanceId: id(2), kind: "monte-carlo" },
      { instanceId: id(3), kind: "text", config: { markdown: "hi" } },
    ],
  };
}

function makeApi(layout: ComparisonLayout): UseLayoutApi {
  return {
    layout,
    move: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    insertTextAt: vi.fn(),
    addTextBlock: vi.fn(),
    updateTextMarkdown: vi.fn(),
    setYearRange: vi.fn(),
    reset: vi.fn(),
    save: vi.fn(async () => {}),
    saving: false,
  };
}

vi.mock("@/lib/comparison/widgets/registry", () => {
  const make = (kind: string, title: string) => ({ kind, title, needsMc: false, render: () => null });
  return {
    COMPARISON_WIDGETS: {
      "kpi-strip": make("kpi-strip", "KPI Strip"),
      portfolio: make("portfolio", "Portfolio"),
      "monte-carlo": make("monte-carlo", "Monte Carlo"),
      longevity: make("longevity", "Longevity"),
      "lifetime-tax": make("lifetime-tax", "Lifetime Tax"),
      liquidity: make("liquidity", "Liquidity"),
      "estate-impact": make("estate-impact", "Estate Impact"),
      "estate-tax": make("estate-tax", "Estate Tax"),
      text: make("text", "Text block"),
      "income-expense": make("income-expense", "Income vs Expense"),
      "withdrawal-source": make("withdrawal-source", "Withdrawal Source"),
      "year-by-year": make("year-by-year", "Year-by-year"),
    },
  };
});

describe("WidgetPanel", () => {
  it("lists current layout items in order under LAYOUT", () => {
    const layout = makeLayout();
    const { container } = render(
      <WidgetPanel layout={layout} api={makeApi(layout)} onDone={vi.fn()} />,
    );
    const rows = container.querySelectorAll("[data-layout-row]");
    expect(Array.from(rows).map((r) => r.getAttribute("data-layout-row"))).toEqual([
      id(1), id(2), id(3),
    ]);
  });

  it("shows kinds that aren't in the layout under AVAILABLE (excluding text)", () => {
    const layout = makeLayout();
    const { container } = render(
      <WidgetPanel layout={layout} api={makeApi(layout)} onDone={vi.fn()} />,
    );
    const available = Array.from(
      container.querySelectorAll("[data-available-kind]"),
    ).map((el) => el.getAttribute("data-available-kind"));
    // 12 kinds total; 3 in layout (portfolio, monte-carlo, text); text is never in Available.
    expect(available).toContain("kpi-strip");
    expect(available).toContain("longevity");
    expect(available).not.toContain("portfolio");
    expect(available).not.toContain("text");
    expect(available).toHaveLength(9);
  });

  it("clicking an available row calls api.add(kind)", () => {
    const layout = makeLayout();
    const api = makeApi(layout);
    const { container } = render(
      <WidgetPanel layout={layout} api={api} onDone={vi.fn()} />,
    );
    const btn = container.querySelector('[data-available-kind="liquidity"]') as HTMLElement;
    fireEvent.click(btn);
    expect(api.add).toHaveBeenCalledWith("liquidity");
  });

  it("clicking remove on a layout row calls api.remove(instanceId)", () => {
    const layout = makeLayout();
    const api = makeApi(layout);
    const { container } = render(
      <WidgetPanel layout={layout} api={api} onDone={vi.fn()} />,
    );
    const removeBtn = container.querySelector(
      `[data-layout-row="${id(2)}"] [data-action="remove"]`,
    ) as HTMLElement;
    fireEvent.click(removeBtn);
    expect(api.remove).toHaveBeenCalledWith(id(2));
  });

  it("clicking 'Insert text' between rows calls api.insertTextAt(index)", () => {
    const layout = makeLayout();
    const api = makeApi(layout);
    const { container } = render(
      <WidgetPanel layout={layout} api={api} onDone={vi.fn()} />,
    );
    // Slot index 1 sits between the first two items.
    const slot = container.querySelector('[data-insert-text-at="1"]') as HTMLElement;
    fireEvent.click(slot);
    expect(api.insertTextAt).toHaveBeenCalledWith(1);
  });

  it("Done button calls onDone", () => {
    const onDone = vi.fn();
    const layout = makeLayout();
    const { getByText } = render(
      <WidgetPanel layout={layout} api={makeApi(layout)} onDone={onDone} />,
    );
    fireEvent.click(getByText("Done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("Reset button calls api.reset after confirm", () => {
    const layout = makeLayout();
    const api = makeApi(layout);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getByText } = render(
      <WidgetPanel layout={layout} api={api} onDone={vi.fn()} />,
    );
    fireEvent.click(getByText(/Reset to default/i));
    expect(api.reset).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Reset is a no-op when user cancels confirm", () => {
    const layout = makeLayout();
    const api = makeApi(layout);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText } = render(
      <WidgetPanel layout={layout} api={api} onDone={vi.fn()} />,
    );
    fireEvent.click(getByText(/Reset to default/i));
    expect(api.reset).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
