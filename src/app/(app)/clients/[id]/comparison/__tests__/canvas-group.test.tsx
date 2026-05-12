// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CanvasGroup } from "../canvas-group";
import type { Group } from "@/lib/comparison/layout-schema";

const noop = () => {};

const blankGroup: Group = {
  id: "g",
  title: "",
  cells: [{ id: "c", span: 5, widget: null }],
};

const wrap = (ui: React.ReactNode) => <DndContext>{ui}</DndContext>;

describe("CanvasGroup", () => {
  it("renders the editable group title", () => {
    const onTitle = vi.fn();
    render(
      wrap(
        <CanvasGroup
          group={{ ...blankGroup, title: "Summary" }}
          scenarios={[]}
          onSetTitle={onTitle}
          onRemoveGroup={noop}
          onAddWidget={noop}
          onEditWidget={noop}
          onRemoveCell={noop}
          onDuplicateCell={noop}
          onAddRight={noop}
          onAddDown={noop}
          onChangeSpan={noop}
        />,
      ),
    );
    const input = screen.getByDisplayValue("Summary");
    fireEvent.change(input, { target: { value: "Tax" } });
    expect(onTitle).toHaveBeenCalledWith("Tax");
  });

  it("calls onRemoveGroup when the delete button is clicked", () => {
    const onRemove = vi.fn();
    render(
      wrap(
        <CanvasGroup
          group={blankGroup}
          scenarios={[]}
          onSetTitle={noop}
          onRemoveGroup={onRemove}
          onAddWidget={noop}
          onEditWidget={noop}
          onRemoveCell={noop}
          onDuplicateCell={noop}
          onAddRight={noop}
          onAddDown={noop}
          onChangeSpan={noop}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /delete group/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("renders every cell from the group", () => {
    const twoCells: Group = {
      id: "g",
      title: "",
      cells: [
        { id: "c1", span: 3, widget: { id: "w1", kind: "portfolio", planIds: ["base"] } },
        { id: "c2", span: 2, widget: null },
      ],
    };
    const { container } = render(
      wrap(
        <CanvasGroup
          group={twoCells}
          scenarios={[{ id: "base", name: "Base" }]}
          onSetTitle={noop}
          onRemoveGroup={noop}
          onAddWidget={noop}
          onEditWidget={noop}
          onRemoveCell={noop}
          onDuplicateCell={noop}
          onAddRight={noop}
          onAddDown={noop}
          onChangeSpan={noop}
        />,
      ),
    );
    expect(container.querySelector("[data-canvas-cell='c1']")).not.toBeNull();
    expect(container.querySelector("[data-canvas-cell='c2']")).not.toBeNull();
  });
});
