// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardGrid } from "@/components/portal/dashboard-grid";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

const DTO: PortalDashboardDTO = {
  spending: { left: 1683, budgeted: 6650, spent: 4967, pace: [
    { day: 1, cumulative: 100, pace: 221 },
    { day: 2, cumulative: 250, pace: 443 },
  ], underBy: 1176, month: "2026-06" },
  netWorth: { assets: 90999, debt: 55022, netWorth: 35977, series: [], asOfDate: "2026-06-24" },
  toReview: { count: 0, sample: [] },
  topCategories: [],
  netThisMonth: { net: -3501, income: 0, spent: 3501, prior: -710, deltaAbs: -2790, deltaPct: 392 },
  recurrings: [],
};

describe("DashboardGrid chart tiles", () => {
  it("renders monthly spending, net worth, and net-this-month", () => {
    render(<DashboardGrid dto={DTO} />);
    expect(screen.getByText("Monthly spending")).toBeInTheDocument();
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("Net this month")).toBeInTheDocument();
    expect(screen.getByText(/under pace/)).toBeInTheDocument();
  });
});
