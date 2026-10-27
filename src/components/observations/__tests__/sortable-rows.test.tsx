// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { placeInOrder, SortableRow, SortableRows } from "../sortable-rows";
import { stackRowsVertically } from "./stack-rows";

afterEach(() => vi.restoreAllMocks());

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
});
