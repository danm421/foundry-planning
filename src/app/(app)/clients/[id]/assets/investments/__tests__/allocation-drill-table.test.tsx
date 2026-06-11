// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AllocationDrillTable from "../allocation-drill-table";
import type { AccountContribution } from "@/lib/investments/allocation";

const contributions: AccountContribution[] = [
  { accountId: "a1", accountName: "Taxable Account", accountValue: 100000, valueInClass: 60000, weightInClass: 0.6 },
  { accountId: "a2", accountName: "IRA", accountValue: 40000, valueInClass: 40000, weightInClass: 1 },
];

function renderTable() {
  return render(
    <AllocationDrillTable
      assetClassName="US Large Cap"
      assetClassColor="#ff0000"
      currentPct={0.5}
      targetPct={0.4}
      contributions={contributions}
      totalInClass={100000}
      onBack={() => {}}
      holdingsByAccount={{
        a1: [
          { holdingId: "h1", ticker: "VOO", name: "Vanguard S&P 500", valueInClass: 45000, blendWeight: 1 },
          { holdingId: "h2", ticker: "VBIAX", name: "Balanced", valueInClass: 15000, blendWeight: 0.6 },
        ],
      }}
    />,
  );
}

describe("AllocationDrillTable holdings expansion", () => {
  it("renders a toggle only for accounts that have holdings", () => {
    renderTable();
    expect(screen.getByRole("button", { name: /Taxable Account/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /IRA/ })).toBeNull();
  });

  it("reveals holding sub-rows on expand and hides them on collapse", () => {
    renderTable();
    expect(screen.queryByText("VOO")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Taxable Account/ }));
    expect(screen.getByText("VOO")).toBeTruthy();
    expect(screen.getByText("VBIAX")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Taxable Account/ }));
    expect(screen.queryByText("VOO")).toBeNull();
  });

  it("hints that a blended fund only partly falls in this class", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Taxable Account/ }));
    // VBIAX has blendWeight 0.6 → "(60.0% of holding)"; VOO is full-weight → no hint.
    expect(screen.getByText(/60\.0% of holding/)).toBeTruthy();
    expect(screen.queryAllByText(/of holding/)).toHaveLength(1);
  });
});
