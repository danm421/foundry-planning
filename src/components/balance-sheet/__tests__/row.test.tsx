// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Row from "../row";

describe("balance-sheet Row with inline slots", () => {
  it("renders the slots in owner / rate / value order", () => {
    render(
      <Row
        editMode={false}
        label="Schwab Ind. Account"
        value="$750,000"
        ownerSlot={<span data-testid="owner">Cooper</span>}
        rateSlot={<span data-testid="rate">6.10%</span>}
        valueSlot={<span data-testid="value">$750,000</span>}
      />,
    );
    const cells = screen.getByTestId("row-cells");
    const order = [...cells.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid"));
    expect(order).toEqual(["owner", "rate", "value"]);
  });

  it("falls back to the plain value string when no valueSlot is given", () => {
    render(<Row editMode={false} label="Loan" value="($10,000)" />);
    expect(screen.getByText("($10,000)")).toBeInTheDocument();
  });

  it("has NO row-level click handler when any slot is present", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Row editMode={false} label="Schwab" value="$1" onClick={onClick}
        valueSlot={<span>$1</span>} />,
    );
    // A row-level handler fights every control inside it — the pencil is the
    // way in. Mirrors net-worth-board.tsx.
    expect(container.querySelector("[data-row-clickable='true']")).toBeNull();
  });

  it("keeps the row click when there are no inline slots", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Row editMode={false} label="Note" value="$1" onClick={onClick} />,
    );
    expect(container.querySelector("[data-row-clickable='true']")).not.toBeNull();
  });

  it("renders a pencil when onEdit is given", () => {
    const onEdit = vi.fn();
    render(
      <Row editMode={false} label="Schwab" value="$1" onEdit={onEdit}
        valueSlot={<span>$1</span>} />,
    );
    expect(screen.getByRole("button", { name: "Edit Schwab" })).toBeInTheDocument();
  });

  // Deliberately its own `it`, not a second assertion on the one above: a
  // pencil wired to nothing still renders, so only a test that CLICKS can
  // discriminate. Merging the two would let the mutation "drop the onEdit()
  // call" redden the existence assertion too, hiding which one did the work.
  it("fires onEdit when the pencil is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <Row editMode={false} label="Schwab" value="$1" onEdit={onEdit}
        valueSlot={<span>$1</span>} />,
    );
    await user.click(screen.getByRole("button", { name: "Edit Schwab" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
