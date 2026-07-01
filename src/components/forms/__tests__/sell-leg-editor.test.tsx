// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SellLegEditor from "../asset-transaction-sell-leg";
import { emptySellLeg } from "../asset-transaction-leg-model";

describe("SellLegEditor", () => {
  it("renders the account source select", () => {
    render(<SellLegEditor leg={emptySellLeg("s")} year={2030} onChange={vi.fn()}
      accounts={[{ id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage" }]}
      liabilities={[]} businesses={[]} pastBuys={[]} projectionYears={null} />);
    expect(screen.getByLabelText(/Account to Sell/i)).toBeTruthy();
  });
});
