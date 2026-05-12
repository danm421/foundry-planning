// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CanvasCell } from "../canvas-cell";
import type { CellV5 } from "@/lib/comparison/layout-schema";

const emptyCell: CellV5 = { id: "c1", span: 3, widget: null };
const filledCell: CellV5 = {
  id: "c2",
  span: 2,
  widget: { id: "w", kind: "portfolio", planIds: ["base"] },
};

const wrap = (ui: React.ReactNode) => <DndContext>{ui}</DndContext>;

describe("CanvasCell v5", () => {
  it("empty cell renders a dashed placeholder with a + button", () => {
    render(
      wrap(
        <CanvasCell
          cell={emptyCell}
          groupId="g"
          scenarios={[]}
          onAddWidget={() => {}}
          onEditWidget={() => {}}
          onRemove={() => {}}
          onDuplicate={() => {}}
          onAddRight={() => {}}
          onAddDown={() => {}}
          onChangeSpan={() => {}}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: /add widget/i })).toBeInTheDocument();
    expect(screen.queryByText(/portfolio/i)).toBeNull();
  });

  it("populated cell shows the widget title and edit/duplicate/remove buttons", () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onRemove = vi.fn();
    render(
      wrap(
        <CanvasCell
          cell={filledCell}
          groupId="g"
          scenarios={[{ id: "base", name: "Base" }]}
          onAddWidget={() => {}}
          onEditWidget={onEdit}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
          onAddRight={() => {}}
          onAddDown={() => {}}
          onChangeSpan={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /edit widget/i }));
    fireEvent.click(screen.getByRole("button", { name: /duplicate widget/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove widget/i }));
    expect(onEdit).toHaveBeenCalled();
    expect(onDuplicate).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
  });

  it("calls onAddRight and onAddDown from the toolbar", () => {
    const onAddRight = vi.fn();
    const onAddDown = vi.fn();
    render(
      wrap(
        <CanvasCell
          cell={filledCell}
          groupId="g"
          scenarios={[{ id: "base", name: "Base" }]}
          onAddWidget={() => {}}
          onEditWidget={() => {}}
          onRemove={() => {}}
          onDuplicate={() => {}}
          onAddRight={onAddRight}
          onAddDown={onAddDown}
          onChangeSpan={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /add right/i }));
    fireEvent.click(screen.getByRole("button", { name: /add down/i }));
    expect(onAddRight).toHaveBeenCalled();
    expect(onAddDown).toHaveBeenCalled();
  });

  it("sets data-span attribute matching the cell's span", () => {
    const { container } = render(
      wrap(
        <CanvasCell
          cell={emptyCell}
          groupId="g"
          scenarios={[]}
          onAddWidget={() => {}}
          onEditWidget={() => {}}
          onRemove={() => {}}
          onDuplicate={() => {}}
          onAddRight={() => {}}
          onAddDown={() => {}}
          onChangeSpan={() => {}}
        />,
      ),
    );
    const el = container.querySelector("[data-canvas-cell='c1']");
    expect(el?.getAttribute("data-span")).toBe("3");
  });

  it("clicking + on an empty cell calls onAddWidget", () => {
    const onAddWidget = vi.fn();
    render(
      wrap(
        <CanvasCell
          cell={emptyCell}
          groupId="g"
          scenarios={[]}
          onAddWidget={onAddWidget}
          onEditWidget={() => {}}
          onRemove={() => {}}
          onDuplicate={() => {}}
          onAddRight={() => {}}
          onAddDown={() => {}}
          onChangeSpan={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /add widget/i }));
    expect(onAddWidget).toHaveBeenCalled();
  });
});
