// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HoldingsTable } from "../holdings-table";

describe("HoldingsTable", () => {
  it("lists every living position with its figures", () => {
    const { container } = render(
      <HoldingsTable rowId="r1" onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 300, holdings: [
        { __holdingId: "t:AAPL#0", ticker: "AAPL", name: "Apple Inc", shares: 10, price: 10, marketValue: 100, costBasis: 80 },
        { __holdingId: "t:MSFT#0", ticker: "MSFT", name: "Microsoft", marketValue: 200, __dropped: true },
      ] }} />,
    );
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(screen.queryByText("Microsoft")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("$80");
  });

  /**
   * A committed account's positions are already in the plan and nothing on
   * this surface can update them — the Commit button is spent,
   * `handleCommitRows` will not resend the row, and `finalize` only marks
   * tabs. `EntityTable` already withholds editing from the account's own
   * cells, and `edit_holding`/`drop_holding` refuse a committed row outright.
   * Offering an editor here changed the screen and nothing else.
   *
   * Mutation this catches: ignoring `readOnly` and rendering the edit/Drop
   * buttons for a committed account.
   */
  it("offers no editor and no Drop for a committed account's positions", () => {
    render(
      <HoldingsTable rowId="r1" readOnly onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 100, holdings: [
        { __holdingId: "t:AAPL#0", ticker: "AAPL", name: "Apple Inc", shares: 10, marketValue: 100 },
      ] }} />,
    );
    // The figures are still READABLE — this is a review surface, so hiding
    // them would be a worse answer than freezing them.
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Drop AAPL/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit shares for AAPL/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps the editors for an account that is not committed yet", () => {
    render(
      <HoldingsTable rowId="r1" onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 100, holdings: [
        { __holdingId: "t:AAPL#0", ticker: "AAPL", name: "Apple Inc", shares: 10, marketValue: 100 },
      ] }} />,
    );
    expect(screen.getByRole("button", { name: /Drop AAPL/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit shares for AAPL/ })).toBeInTheDocument();
  });

  /**
   * The prod failure this whole feature traces back to was a muni ladder, and
   * bonds price per $100 par. Whole dollars render 99.875 as "$100" and a
   * sub-dollar position as "$0", which makes the one screen built for
   * checking a position's price unable to show it.
   *
   * Mutation this catches: formatting `price` as whole-dollar money.
   */
  it("keeps a bond's per-unit price at the precision it was quoted", () => {
    const { container } = render(
      <HoldingsTable rowId="r1" onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 100, holdings: [
        { __holdingId: "n:MUNI#0", name: "CA ST 4.125% 11/15/2032", shares: 100, price: 99.875, marketValue: 9987.5 },
      ] }} />,
    );
    expect(container).toHaveTextContent("$99.875");
    // The market value beside it stays whole dollars — only the QUOTE needs
    // the precision.
    expect(container).toHaveTextContent("$9,988");
  });

  it("renders nothing when every position is tombstoned", () => {
    const { container } = render(
      <HoldingsTable rowId="r1" onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100, __dropped: true }] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the placeholder for a holding missing a figure", () => {
    const { container } = render(
      <HoldingsTable rowId="r1" onEditHolding={vi.fn()} onDropHolding={vi.fn()} row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", name: "Apple Inc" }] }} />,
    );
    expect(container).toHaveTextContent("—");
  });

  it("writes an edited share count through onEditHolding as a number", async () => {
    const onEditHolding = vi.fn();
    render(
      <HoldingsTable
        rowId="r1"
        row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 }] }}
        onEditHolding={onEditHolding}
        onDropHolding={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /edit shares for AAPL/i }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "12");
    await userEvent.tab();

    expect(onEditHolding).toHaveBeenCalledWith("r1", "t:AAPL#0", "shares", 12);
  });

  it("drops a position through onDropHolding", async () => {
    const onDropHolding = vi.fn();
    render(
      <HoldingsTable
        rowId="r1"
        row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL" }] }}
        onEditHolding={vi.fn()}
        onDropHolding={onDropHolding}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /drop AAPL/i }));
    expect(onDropHolding).toHaveBeenCalledWith("r1", "t:AAPL#0");
  });

  // R20: `Number("")` is `0`, and `Number.isFinite(0)` is `true` — so without
  // the blank-guard in `commitEdit`, clearing a numeric cell (or typing
  // something `<input type="number">` itself sanitizes back to `""`, e.g.
  // "abc") would silently write `shares: 0` instead of being rejected.
  it("does not write when a numeric cell is cleared to blank", async () => {
    const onEditHolding = vi.fn();
    render(
      <HoldingsTable
        rowId="r1"
        row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 }] }}
        onEditHolding={onEditHolding}
        onDropHolding={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /edit shares for AAPL/i }));
    await userEvent.clear(screen.getByRole("spinbutton"));
    await userEvent.tab();

    expect(onEditHolding).not.toHaveBeenCalled();
  });

  // Escape is documented behaviour ("the one way out of an editor opened by
  // mistake") and has a real failure mode to pin: pressing Escape unmounts
  // the `<input>` via the conditional swap back to the read-only button, and
  // unmounting a FOCUSED element fires a native blur — if that blur were to
  // re-trigger `commitEdit`, the value the advisor just tried to discard
  // would be written anyway.
  it("discards the in-progress edit on Escape without calling onEditHolding", async () => {
    const onEditHolding = vi.fn();
    render(
      <HoldingsTable
        rowId="r1"
        row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 }] }}
        onEditHolding={onEditHolding}
        onDropHolding={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /edit shares for AAPL/i }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.keyboard("{Escape}");

    expect(onEditHolding).not.toHaveBeenCalled();
    // Back to the read-only button, still showing the ORIGINAL value — not
    // the discarded "999".
    expect(screen.getByRole("button", { name: /edit shares for AAPL/i })).toHaveTextContent("10");
  });
});
