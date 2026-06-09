// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FutureActivityLedger from "@/components/stock-options/future-activity-ledger";
import type { FutureActivityModel } from "@/engine/equity/future-activity";

const base: Omit<FutureActivityModel, "groups" | "hasGrants"> = {
  asOfYear: 2026, planEndYear: 2035,
  totals: { shares: 1000, grossValue: 40000, exerciseCost: 0, netCash: 0, taxImpact: null },
  hasTaxImpact: false,
};

function model(over: Partial<FutureActivityModel>): FutureActivityModel {
  return { ...base, groups: [], hasGrants: true, ...over } as FutureActivityModel;
}

describe("FutureActivityLedger", () => {
  it("renders a year group, an event row, and the pending tax cell", () => {
    const m = model({
      groups: [
        {
          year: 2027,
          events: [
            {
              year: 2027, kind: "vest", grantId: "g", grantLabel: "RSU-09",
              trancheId: "t", trancheLabel: "T1", grantType: "rsu", ticker: "ACME",
              shares: 1000, pricePerShare: 40, grossValue: 40000,
              exerciseCost: null, netCash: null, underwater: false, taxImpact: null,
            },
          ],
          subtotal: { shares: 1000, grossValue: 40000, exerciseCost: 0, netCash: 0, taxImpact: null },
        },
      ],
    });
    render(<FutureActivityLedger model={m} />);
    expect(screen.getByText("2027")).toBeTruthy();
    expect(screen.getByText("RSU-09")).toBeTruthy();
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
  });

  it("shows the no-grants empty state", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: false })} />);
    expect(screen.getByText(/No stock option grants/i)).toBeTruthy();
  });

  it("shows the no-activity empty state when there are grants but no events", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: true })} />);
    expect(screen.getByText(/No planned activity/i)).toBeTruthy();
  });

  it("renders 'pending' in an exercise event's tax cell (not just the footnote)", () => {
    const m = model({
      groups: [
        {
          year: 2028,
          events: [
            {
              year: 2028, kind: "exercise", grantId: "g2", grantLabel: "NQSO-17",
              trancheId: "t2", trancheLabel: "T1", grantType: "nqso", ticker: "ACME",
              shares: 500, pricePerShare: 50, grossValue: 15000,
              exerciseCost: 10000, netCash: -10000, underwater: false, taxImpact: null,
            },
          ],
          subtotal: { shares: 500, grossValue: 15000, exerciseCost: 10000, netCash: -10000, taxImpact: null },
        },
      ],
    });
    render(<FutureActivityLedger model={m} />);
    const pendingCell = screen
      .getAllByRole("cell")
      .some((c) => /pending/i.test(c.textContent ?? ""));
    expect(pendingCell).toBe(true);
  });
});
