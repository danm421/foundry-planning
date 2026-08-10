// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TileNetWorth } from "@/components/portal/dashboard-tiles/tile-net-worth";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

function netWorth(
  over: Partial<PortalDashboardDTO["netWorth"]> = {},
): PortalDashboardDTO["netWorth"] {
  return {
    assets: 700,
    debt: 100,
    netWorth: 600,
    series: [],
    asOfDate: "2026-06-24",
    accounts: [
      { id: "a1", name: "Brokerage", value: 300 },
      { id: "a2", name: "401k", value: 150 },
      { id: "a3", name: "Roth IRA", value: 100 },
      { id: "a4", name: "Checking", value: 80 },
      { id: "a5", name: "Savings", value: 50 },
      { id: "a6", name: "HSA", value: 20 },
    ],
    debts: [],
    assetGroups: [
      { category: "taxable", label: "Taxable", total: 300 },
      { category: "retirement", label: "Retirement", total: 270 },
      { category: "cash", label: "Cash", total: 130 },
    ],
    ...over,
  };
}

describe("TileNetWorth", () => {
  it("lists asset-type subtotals in balance-sheet order", () => {
    render(<TileNetWorth netWorth={netWorth()} onOpen={vi.fn()} />);
    const labels = screen.getAllByText(/^(Taxable|Retirement|Cash)$/).map((n) => n.textContent);
    expect(labels).toEqual(["Taxable", "Retirement", "Cash"]);
    // $270 rolls up two retirement accounts, so it can only be the subtotal —
    // unlike $300, which the Brokerage row also renders.
    expect(screen.getByText("$270")).toBeInTheDocument();
    expect(screen.getByText("$130")).toBeInTheDocument();
  });

  it("shows the top 5 accounts and expands the rest inline", async () => {
    const user = userEvent.setup();
    render(<TileNetWorth netWorth={netWorth()} onOpen={vi.fn()} />);
    expect(screen.getByText("Top 5 accounts")).toBeInTheDocument();
    expect(screen.queryByText("HSA")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByText("HSA")).toBeInTheDocument();
    expect(screen.getByText("Accounts", { selector: "div" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("HSA")).not.toBeInTheDocument();
  });

  it("offers no expander when every account already fits", () => {
    render(
      <TileNetWorth
        netWorth={netWorth({ accounts: [{ id: "a1", name: "Brokerage", value: 300 }] })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
  });

  // The drill-down opener is the only affordance the dashboard test selects by
  // /Assets/ — the accounts list must not add a second button matching it.
  it("keeps a single Assets-labelled opener", () => {
    render(<TileNetWorth netWorth={netWorth()} onOpen={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /Assets/ })).toHaveLength(1);
  });
});
