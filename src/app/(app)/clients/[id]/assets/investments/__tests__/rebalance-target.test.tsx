// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RebalanceTarget, type RebalanceTargetValue } from "../rebalance-target";

const PORTFOLIOS = [{ id: "tp-1", name: "Core Moderate" }];

/** What a reopened proposal hands the editor: the stored ad-hoc target. */
const reopened: RebalanceTargetValue = {
  kind: "new",
  holdings: [
    { ticker: "VTI", weight: 0.6 },
    { ticker: "BND", weight: 0.4 },
  ],
  saveToCma: false,
};

const tickerValues = () =>
  (screen.getAllByLabelText("Ticker symbol") as HTMLInputElement[]).map((i) => i.value);

describe("RebalanceTarget, reopened with a stored ad-hoc target", () => {
  it("shows the stored tickers and their weights instead of a blank row", () => {
    render(
      <RebalanceTarget fundPortfolios={PORTFOLIOS} value={reopened} onChange={vi.fn()} />,
    );
    expect(tickerValues()).toEqual(["VTI", "BND"]);
    const weights = screen.getAllByLabelText("Weight percentage") as HTMLInputElement[];
    expect(weights.map((i) => i.value)).toEqual(["60", "40"]);
    // A blank seed would read "Total: 0.00%" over a proposal that stores 100%.
    expect(screen.getByText("Total: 100.00%")).toBeInTheDocument();
  });

  it("keeps the other holdings when the first field is edited", async () => {
    const onChange = vi.fn();
    render(
      <RebalanceTarget fundPortfolios={PORTFOLIOS} value={reopened} onChange={onChange} />,
    );
    await userEvent.type(screen.getAllByLabelText("Ticker symbol")[0], "X");

    const emitted = onChange.mock.calls.at(-1)![0] as RebalanceTargetValue;
    if (emitted.kind !== "new") throw new Error("expected an ad-hoc target");
    expect(emitted.holdings).toEqual([
      { ticker: "VTIX", weight: 0.6 },
      { ticker: "BND", weight: 0.4 },
    ]);
  });

  it("still opens a fresh build on one blank row", () => {
    // What "Build new" emits before a ticker is typed: `emitNew` drops blank
    // rows, so the value carries no holdings. The seed must not read that as a
    // stored target to restore.
    render(
      <RebalanceTarget
        fundPortfolios={PORTFOLIOS}
        value={{ kind: "new", holdings: [], saveToCma: false }}
        onChange={vi.fn()}
      />,
    );
    expect(tickerValues()).toEqual([""]);
    expect(screen.getByText("Total: 0.00%")).toBeInTheDocument();
  });
});
