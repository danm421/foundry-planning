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
});
