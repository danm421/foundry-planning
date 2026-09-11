// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingsTable } from "../holdings-table";

describe("HoldingsTable", () => {
  it("lists every living position with its figures", () => {
    const { container } = render(
      <HoldingsTable row={{ value: 300, holdings: [
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
      <HoldingsTable row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100, __dropped: true }] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the placeholder for a holding missing a figure", () => {
    const { container } = render(
      <HoldingsTable row={{ value: 100, holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", name: "Apple Inc" }] }} />,
    );
    expect(container).toHaveTextContent("—");
  });
});
