// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WidgetCard } from "../widget-card";
import type { WidgetInstance } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => ({
  COMPARISON_WIDGETS: {
    portfolio: {
      kind: "portfolio", title: "Portfolio Assets", category: "cashflow",
      scenarios: "one-or-many", needsMc: false, render: () => null,
    },
    text: {
      kind: "text", title: "Text block", category: "text",
      scenarios: "none", needsMc: false, render: () => null,
    },
    "year-by-year": {
      kind: "year-by-year", title: "Year-by-year", category: "cashflow",
      scenarios: "many-only", needsMc: false, render: () => null,
    },
  },
}));

const widget = (kind: string, planIds: string[]): WidgetInstance =>
  ({ id: "w", kind, planIds } as unknown as WidgetInstance);

describe("WidgetCard", () => {
  it("renders title + plan chip labels for a one-or-many widget", () => {
    render(
      <WidgetCard
        widget={widget("portfolio", ["base", "sc-1"])}
        widthBadge="½"
        scenarios={[{ id: "base", name: "Base" }, { id: "sc-1", name: "Roth Heavy" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    expect(screen.getByText("Portfolio Assets")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Roth Heavy")).toBeInTheDocument();
    expect(screen.getByText("½")).toBeInTheDocument();
  });

  it("hides plan chips for a 'none' widget", () => {
    render(
      <WidgetCard
        widget={widget("text", [])}
        widthBadge="full"
        scenarios={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    expect(screen.queryByTestId("plan-chip")).toBeNull();
  });

  it("shows an 'Add scenario' hint for many-only with one plan", () => {
    render(
      <WidgetCard
        widget={widget("year-by-year", ["base"])}
        widthBadge="½"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    expect(screen.getByText(/needs a second scenario/i)).toBeInTheDocument();
  });

  it("invokes onEdit and onRemove from their buttons", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <WidgetCard
        widget={widget("portfolio", ["base"])}
        widthBadge="full"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={onEdit}
        onRemove={onRemove}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Edit widget/i));
    fireEvent.click(screen.getByLabelText(/Remove widget/i));
    expect(onEdit).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
  });

  it("invokes onDuplicate from the duplicate button", () => {
    const onDuplicate = vi.fn();
    render(
      <WidgetCard
        widget={widget("portfolio", ["base"])}
        widthBadge="full"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={onDuplicate}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Duplicate widget/i));
    expect(onDuplicate).toHaveBeenCalled();
  });

  it("invokes onMoveLeft/onMoveRight from arrow buttons", () => {
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    render(
      <WidgetCard
        widget={widget("portfolio", ["base"])}
        widthBadge="½"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
        canMoveLeft={true}
        canMoveRight={true}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Move widget left/i));
    fireEvent.click(screen.getByLabelText(/Move widget right/i));
    expect(onMoveLeft).toHaveBeenCalled();
    expect(onMoveRight).toHaveBeenCalled();
  });

  it("disables move-left at the start and move-right at the end", () => {
    render(
      <WidgetCard
        widget={widget("portfolio", ["base"])}
        widthBadge="½"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={false}
        canMoveRight={false}
      />,
    );
    expect(screen.getByLabelText(/Move widget left/i)).toBeDisabled();
    expect(screen.getByLabelText(/Move widget right/i)).toBeDisabled();
  });

  it("forwards a sortable drag handle (data-drag-handle) on the card", () => {
    render(
      <WidgetCard
        widget={widget("portfolio", ["base"])}
        widthBadge="full"
        scenarios={[{ id: "base", name: "Base" }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveLeft={vi.fn()}
        onMoveRight={vi.fn()}
        canMoveLeft={true}
        canMoveRight={true}
      />,
    );
    expect(document.querySelector("[data-drag-handle='widget']")).not.toBeNull();
  });
});
