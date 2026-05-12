// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { CanvasRow } from "../canvas-row";
import type { Row } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => ({
  COMPARISON_WIDGETS: {
    portfolio: {
      kind: "portfolio", title: "Portfolio", category: "investments",
      scenarios: "one-or-many", needsMc: false, render: () => null,
    },
    "monte-carlo": {
      kind: "monte-carlo", title: "Monte Carlo", category: "monte-carlo",
      scenarios: "one-or-many", needsMc: true, render: () => null,
    },
  },
}));

const row: Row = {
  id: "row-1",
  cells: [
    { id: "c1", widget: { id: "w1", kind: "portfolio", planIds: ["base"] } },
    { id: "c2", widget: { id: "w2", kind: "monte-carlo", planIds: ["base"] } },
  ],
};

describe("CanvasRow", () => {
  it("renders one WidgetCard per cell with the right width badge", () => {
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    const cards = screen.getAllByText(/Portfolio|Monte Carlo/);
    expect(cards.length).toBe(2);
    // 2 cells → each badge says "½"
    const badges = screen.getAllByText("½");
    expect(badges.length).toBe(2);
  });

  it("disables Add cell when row has 5 cells", () => {
    const full: Row = {
      id: "r5",
      cells: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        widget: { id: `w${i}`, kind: "portfolio" as const, planIds: ["base"] },
      })),
    };
    render(
      <CanvasRow
        row={full}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    expect(screen.getByLabelText(/Add cell/i)).toBeDisabled();
  });

  it("invokes onAddCell with the row id when Add cell is clicked", () => {
    const onAddCell = vi.fn();
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={onAddCell}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Add cell/i));
    expect(onAddCell).toHaveBeenCalledWith("row-1");
  });

  it("invokes onRemoveCell with rowId and cellId from each card", () => {
    const onRemoveCell = vi.fn();
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={onRemoveCell}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    const removeButtons = screen.getAllByLabelText(/Remove widget/i);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveCell).toHaveBeenCalledWith("row-1", "c1");
  });

  it("invokes onDeleteRow with the row id when Delete row is clicked", () => {
    const onDeleteRow = vi.fn();
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={onDeleteRow}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Delete row/i));
    expect(onDeleteRow).toHaveBeenCalledWith("row-1");
  });

  it("invokes onEditCell with the cell id when Edit widget is clicked", () => {
    const onEditCell = vi.fn();
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={onEditCell}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/Edit widget/i)[0]);
    expect(onEditCell).toHaveBeenCalledWith("c1");
  });

  it("invokes onMoveUp/onMoveDown when up/down buttons are clicked", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={true}
        canMoveDown={true}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Move row up/i));
    fireEvent.click(screen.getByLabelText(/Move row down/i));
    expect(onMoveUp).toHaveBeenCalledWith("row-1");
    expect(onMoveDown).toHaveBeenCalledWith("row-1");
  });

  it("disables up at top and down at bottom", () => {
    render(
      <CanvasRow
        row={row}
        scenarios={[{ id: "base", name: "Base" }]}
        onEditCell={vi.fn()}
        onRemoveCell={vi.fn()}
        onAddCell={vi.fn()}
        onDeleteRow={vi.fn()}
        onDuplicateCell={vi.fn()}
        onMoveCellLeft={vi.fn()}
        onMoveCellRight={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        canMoveUp={false}
        canMoveDown={false}
      />,
    );
    expect(screen.getByLabelText(/Move row up/i)).toBeDisabled();
    expect(screen.getByLabelText(/Move row down/i)).toBeDisabled();
  });
});
