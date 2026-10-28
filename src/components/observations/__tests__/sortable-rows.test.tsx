// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { keepInScrollArea, placeInOrder, SortableRow, SortableRows } from "../sortable-rows";
import { stackRowsVertically } from "./stack-rows";

afterEach(() => vi.restoreAllMocks());

function renderList(onReorder: (ids: string[]) => void) {
  return render(
    <SortableRows ids={["one", "two", "three"]} onReorder={onReorder}>
      <ul>
        {["one", "two", "three"].map((id) => (
          <SortableRow key={id} id={id} className="flex">
            <span>{id}</span>
            <button type="button">Edit {id}</button>
          </SortableRow>
        ))}
      </ul>
    </SortableRows>,
  );
}

describe("placeInOrder", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("reorders only the named rows, inside the slots they already held", () => {
    // b and d swap; a, c and e (another topic, or the finished steps) stay put.
    expect(placeInOrder(rows, ["d", "b"]).map((r) => r.id)).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("ignores an id that is no longer in the list", () => {
    expect(placeInOrder(rows, ["gone", "c", "a"]).map((r) => r.id)).toEqual(["c", "b", "a", "d", "e"]);
  });
});

describe("SortableRows", () => {
  it("a keyboard drag hands back the new order", async () => {
    stackRowsVertically();
    const onReorder = vi.fn();
    render(
      <SortableRows ids={["one", "two", "three"]} onReorder={onReorder}>
        <ul>
          {["one", "two", "three"].map((id) => (
            <SortableRow key={id} id={id} className="flex">
              <span>{id}</span>
            </SortableRow>
          ))}
        </ul>
      </SortableRows>,
    );
    screen.getAllByRole("button", { name: /drag to reorder/i })[0].focus();
    await userEvent.keyboard("[Space][ArrowDown][Space]");
    expect(onReorder).toHaveBeenCalledWith(["two", "one", "three"]);
  });

  // The grip is small; a drag that starts on the row's words has to work too,
  // the way the deck's own page rows already do.
  it("a mouse drag that starts on the row's text hands back the new order, without stretching the row", async () => {
    stackRowsVertically();
    const onReorder = vi.fn();
    renderList(onReorder);
    const row = screen.getByText("one");
    const user = userEvent.setup();
    await user.pointer([
      { keys: "[MouseLeft>]", target: row, coords: { clientX: 10, clientY: 15 } },
      { target: row, coords: { clientX: 10, clientY: 35 } },
      { target: row, coords: { clientX: 10, clientY: 58 } },
    ]);
    // Rows differ in height for real; a scale in the transform squashes the
    // dragged one to fit the slot it is passing.
    expect(row.closest("li")!.style.transform).not.toMatch(/scale/);
    await user.pointer({ keys: "[/MouseLeft]", target: row, coords: { clientX: 10, clientY: 58 } });
    expect(onReorder).toHaveBeenCalledWith(["two", "one", "three"]);
  });

  it("Space on a button inside the row presses the button — it never starts a drag", async () => {
    stackRowsVertically();
    const onReorder = vi.fn();
    renderList(onReorder);
    screen.getByRole("button", { name: "Edit one" }).focus();
    await userEvent.keyboard("[Space][ArrowDown][Space]");
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe("keepInScrollArea", () => {
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 300, width: 300 });
  // A row at y=500 inside a dialog body whose visible box runs y=200..600.
  const drag = (x: number, y: number) =>
    keepInScrollArea({
      transform: { x, y, scaleX: 1, scaleY: 1 },
      draggingNodeRect: rect(500, 40),
      scrollableAncestorRects: [rect(200, 400)],
    } as Parameters<typeof keepInScrollArea>[0]);

  it("holds the row inside the box that scrolls it, so auto-scroll can't run away", () => {
    expect(drag(0, 900)).toMatchObject({ y: 60 });
    expect(drag(0, -900)).toMatchObject({ y: -300 });
    expect(drag(0, 20)).toMatchObject({ y: 20 });
  });

  it("moves the row up and down only", () => {
    expect(drag(45, 20)).toMatchObject({ x: 0 });
  });
});
