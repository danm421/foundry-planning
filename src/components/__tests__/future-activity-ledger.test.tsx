// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FutureActivityLedger from "@/components/stock-options/future-activity-ledger";
import type {
  FutureActivityModel,
  FutureActivityGrantYearRow,
  FutureActivitySubtotal,
} from "@/engine/equity/future-activity";

const ZERO_SUB: FutureActivitySubtotal = {
  sharesVested: 0, sharesExercised: 0, exerciseCost: 0, sharesSold: 0,
  grossProceeds: 0, netProceeds: 0, taxImpact: null,
};

function row(over: Partial<FutureActivityGrantYearRow>): FutureActivityGrantYearRow {
  return {
    year: 2027, grantId: "g-rsu", owner: "client", planLabel: "ACME", grantNumber: "RSU-09",
    grantType: "rsu", grantDate: "2026", sharesVested: 0, sharesExercised: 0,
    exercisePrice: null, exerciseCost: 0, sharesSold: 0, hasSellToCover: false,
    salePrice: 100, grossProceeds: 0, netProceeds: 0, expiredShares: 0,
    underwater: false, taxImpact: null, ...over,
  };
}

const base: Omit<FutureActivityModel, "groups" | "hasGrants"> = {
  asOfYear: 2026, planEndYear: 2035, totals: ZERO_SUB, hasTaxImpact: false,
};
function model(over: Partial<FutureActivityModel>): FutureActivityModel {
  return { ...base, groups: [], hasGrants: true, ...over } as FutureActivityModel;
}

describe("FutureActivityLedger", () => {
  it("renders a year group, a sell-to-cover row with the cover tag, and pending tax cells", () => {
    const r = row({ sharesVested: 100, sharesSold: 25, hasSellToCover: true, grossProceeds: 2500, netProceeds: 2500 });
    const m = model({
      groups: [{ year: 2027, rows: [r], subtotal: { ...ZERO_SUB, sharesVested: 100, sharesSold: 25, grossProceeds: 2500, netProceeds: 2500 } }],
    });
    render(<FutureActivityLedger model={m} />);
    expect(screen.getByText("2027")).toBeTruthy();
    expect(screen.getByText("RSU-09")).toBeTruthy();
    // "cover" appears twice: the row badge + the footnote legend. Asserting === 2
    // keeps the badge under test (footnote alone would only yield 1).
    expect(screen.getAllByText("cover").length).toBe(2);
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
  });

  it("shows the no-grants empty state", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: false })} />);
    expect(screen.getByText(/No stock option grants/i)).toBeTruthy();
  });

  it("shows the no-activity empty state when there are grants but no rows", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: true })} />);
    expect(screen.getByText(/No planned activity/i)).toBeTruthy();
  });

  it("flags an underwater expiry row", () => {
    const r = row({ grantType: "nqso", grantNumber: "NQSO-17", expiredShares: 500, underwater: true });
    const m = model({ groups: [{ year: 2030, rows: [r], subtotal: ZERO_SUB }] });
    render(<FutureActivityLedger model={m} />);
    expect(screen.getByText(/underwater/i)).toBeTruthy();
  });
});
