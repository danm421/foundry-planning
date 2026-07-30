// @vitest-environment jsdom
//
// The Inflows & Outflows row, once it hosts inline cells. Mirrors
// `balance-sheet/__tests__/row.test.tsx` — same component shape, different
// columns (start / end / rate rather than owner / rate / value).
//
// There is no `ownerSlot` case here: the income `owner` column is the
// three-value enum `"client" | "spouse" | "joint"`, which `InlineOwnerCell`
// (built for `AccountOwner[]` + `titlingType`) cannot represent without
// offering picks that silently collapse. Parked for a design decision.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Row from "../row";

describe("income-expenses Row with inline slots", () => {
  it("renders start / end / rate in order before the amount", () => {
    render(
      <Row
        editMode={false}
        label="Salary"
        value="$200,000"
        startSlot={<span data-testid="start">2026</span>}
        endSlot={<span data-testid="end">2035</span>}
        rateSlot={<span data-testid="rate">3.00%</span>}
      />,
    );
    const order = [...screen.getByTestId("row-cells").querySelectorAll("[data-testid]")]
      .map((n) => n.getAttribute("data-testid"));
    expect(order).toEqual(["start", "end", "rate"]);
  });

  it("drops the legacy starts column when startSlot is given", () => {
    render(
      <Row
        editMode={false}
        label="Salary"
        value="$1"
        starts="2026-2035"
        startSlot={<span data-testid="start">2026</span>}
      />,
    );
    expect(screen.queryByText("2026-2035")).not.toBeInTheDocument();
  });

  it("keeps the legacy starts column when no startSlot is given", () => {
    render(<Row editMode={false} label="Salary" value="$1" starts="2026-2035" />);
    expect(screen.getByText("2026-2035")).toBeInTheDocument();
  });

  it("has NO row-level click handler when any slot is present", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Row
        editMode={false}
        label="Salary"
        value="$1"
        onClick={onClick}
        startSlot={<span data-testid="start">2026</span>}
      />,
    );
    // A row-level handler swallows clicks meant for the controls inside it —
    // the pencil is the way into the full editor. Mirrors balance-sheet/row.tsx.
    expect(container.querySelector("[data-row-clickable='true']")).toBeNull();
  });

  it("keeps the row click when there are no inline slots", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Row editMode={false} label="Living" value="$1" onClick={onClick} />,
    );
    expect(container.querySelector("[data-row-clickable='true']")).not.toBeNull();
  });

  it("renders a pencil when onEdit is given", () => {
    const onEdit = vi.fn();
    render(
      <Row
        editMode={false}
        label="Salary"
        value="$1"
        onEdit={onEdit}
        startSlot={<span data-testid="start">2026</span>}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit Salary" })).toBeInTheDocument();
  });

  // Its own `it`, not a second assertion above: a pencil wired to nothing still
  // renders, so only a test that CLICKS can discriminate.
  it("fires onEdit when the pencil is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <Row
        editMode={false}
        label="Salary"
        value="$1"
        onEdit={onEdit}
        startSlot={<span data-testid="start">2026</span>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit Salary" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
