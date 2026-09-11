// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingsCell } from "../holdings-cell";

describe("HoldingsCell", () => {
  it("pairs the count with the reconciliation when the positions add up", () => {
    const { container } = render(
      <HoldingsCell row={{ value: 300, holdings: [
        { ticker: "AAPL", marketValue: 100 }, { ticker: "VTI", marketValue: 200 },
      ] }} />,
    );
    expect(container).toHaveTextContent(/2\s*holdings/);
    expect(container).toHaveTextContent("$300 of $300");
  });

  it("counts living positions only", () => {
    const { container } = render(
      <HoldingsCell row={{ value: 100, holdings: [
        { ticker: "AAPL", marketValue: 100 }, { ticker: "MSFT", marketValue: 900, __dropped: true },
      ] }} />,
    );
    expect(container).toHaveTextContent(/1\s*holding\b/);
  });

  it("flags a materially short position set — the truncation case", () => {
    render(
      <HoldingsCell row={{ value: 2727270, holdings: [{ ticker: "AAPL", marketValue: 1410000 }] }} />,
    );
    // The advisor must be able to SEE the shortfall, not infer it from two
    // totals: a prod statement extracted 33 of ~63 positions and read as fine.
    expect(screen.getByText(/short/i)).toBeInTheDocument();
  });

  it("renders an em dash for an account with no positions", () => {
    const { container } = render(<HoldingsCell row={{ value: 100 }} />);
    expect(container).toHaveTextContent("—");
  });
});
