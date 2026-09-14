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

  /**
   * The `· over` branch had never been rendered or tested — Task 10's only
   * over-sum account fell inside the $100/1% tolerance. An unflagged overage
   * and a flagged one look identical without it.
   *
   * Mutation this catches: dropping the `flagged` (over) arm of the suffix.
   */
  it("flags a position set that overshoots the stated value", () => {
    render(
      <HoldingsCell row={{ value: 100000, holdings: [{ ticker: "AAPL", marketValue: 150000 }] }} />,
    );
    expect(screen.getByText(/over/i)).toBeInTheDocument();
  });

  /**
   * `holdingsReconciliation` defaults a missing stated value to 0, so this
   * rendered "$604,756 of $0" — which reads as a total loss rather than the
   * missing input it is (and nothing warns, because `flagged` is suppressed
   * on `total > 0`).
   *
   * Mutation this catches: printing the defaulted 0 as a real stated total.
   */
  it("does not invent a $0 stated total for an account that has none", () => {
    const { container } = render(
      <HoldingsCell row={{ holdings: [{ ticker: "AAPL", marketValue: 604756 }] }} />,
    );
    expect(container).toHaveTextContent("$604,756");
    expect(container).not.toHaveTextContent("of $0");
    expect(container).toHaveTextContent(/no stated total/i);
  });

  it("renders an em dash for an account with no positions", () => {
    const { container } = render(<HoldingsCell row={{ value: 100 }} />);
    expect(container).toHaveTextContent("—");
  });
});
