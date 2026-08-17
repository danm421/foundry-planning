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
  expiredShares: 0, grossProceeds: 0, netProceeds: 0, taxImpact: null,
};

function row(over: Partial<FutureActivityGrantYearRow>): FutureActivityGrantYearRow {
  return {
    year: 2027, grantId: "g-rsu", owner: "client", planLabel: "ACME", grantNumber: "RSU-09",
    grantType: "rsu", grantDate: "2026-01-15", sharesVested: 0, sharesExercised: 0,
    exercisePrice: null, exerciseCost: 0, sharesSold: 0, hasSellToCover: false,
    salePrice: 100, grossProceeds: 0, netProceeds: 0, expiredShares: 0,
    expiredUnderwater: false, expiredForfeitedValue: 0, taxImpact: null, ...over,
  };
}

const base: Omit<FutureActivityModel, "groups" | "hasGrants"> = {
  asOfYear: 2026, planEndYear: 2035, totals: ZERO_SUB, hasTaxImpact: false,
};
function model(over: Partial<FutureActivityModel>): FutureActivityModel {
  return { ...base, groups: [], hasGrants: true, ...over } as FutureActivityModel;
}

describe("FutureActivityLedger", () => {
  it("renders a year group, a sell-to-cover row, and tax impact on the subtotal + grand total", () => {
    const r = row({ sharesVested: 100, sharesSold: 25, hasSellToCover: true, grossProceeds: 2500, netProceeds: 2500 });
    const sub = { ...ZERO_SUB, sharesVested: 100, sharesSold: 25, grossProceeds: 2500, netProceeds: 2500, taxImpact: 1000 };
    const m = model({ groups: [{ year: 2027, rows: [r], subtotal: sub }], totals: sub });
    render(<FutureActivityLedger model={m} />);
    expect(screen.getByText("2027")).toBeTruthy();
    expect(screen.getByText("RSU-09")).toBeTruthy();
    // "cover" appears twice: the row badge + the footnote legend. Asserting === 2
    // keeps the badge under test (footnote alone would only yield 1).
    expect(screen.getAllByText("cover").length).toBe(2);
    // Tax Impact ($1K) and After Tax ($1.5K = net − tax) each render on the year
    // subtotal AND the grand total; per-grant rows stay "—" (no `pending` placeholder).
    expect(screen.queryByText(/pending/i)).toBeNull();
    expect(screen.getAllByText("$1K").length).toBe(2);
    expect(screen.getAllByText("$1.5K").length).toBe(2);
  });

  it("shows the no-grants empty state", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: false })} />);
    expect(screen.getByText(/No stock option grants/i)).toBeTruthy();
  });

  it("shows the no-activity empty state when there are grants but no rows", () => {
    render(<FutureActivityLedger model={model({ groups: [], hasGrants: true })} />);
    expect(screen.getByText(/No planned activity/i)).toBeTruthy();
  });

  // ── Audit F37 ──────────────────────────────────────────────────────────────

  it("marks a genuinely out-of-the-money lapse underwater", () => {
    const r = row({ grantType: "nqso", grantNumber: "NQSO-17", expiredShares: 500, expiredUnderwater: true });
    const m = model({ groups: [{ year: 2030, rows: [r], subtotal: { ...ZERO_SUB, expiredShares: 500 } }] });
    render(<FutureActivityLedger model={m} />);
    // Twice: the row's tag and the footnote legend.
    expect(screen.getAllByText(/underwater/i).length).toBe(2);
    expect(screen.queryByText(/forfeited/i)).toBeNull();
  });

  it("names the value given up when an IN-THE-MONEY option lapses", () => {
    const r = row({
      grantType: "nqso", grantNumber: "NQSO-17", expiredShares: 1000,
      expiredUnderwater: false, expiredForfeitedValue: 90_000,
    });
    const m = model({ groups: [{ year: 2030, rows: [r], subtotal: { ...ZERO_SUB, expiredShares: 1000 } }] });
    render(<FutureActivityLedger model={m} />);
    expect(screen.getByText(/\$90K forfeited/i)).toBeTruthy();
    // The old cell called this "underwater"; only the footnote legend may now.
    expect(screen.getAllByText(/underwater/i).length).toBe(1);
  });

  it("shows sold and expired shares in their own columns, and both add up", () => {
    // The count used to sit in the Sh. Sold cell, excluded from that column's
    // subtotal — so the row read 1,000 and the subtotal read a dash. And a row
    // with a sale could not show a lapse at all.
    const r = row({ grantType: "nqso", grantNumber: "NQSO-17", sharesSold: 400, expiredShares: 1000, expiredUnderwater: true });
    const sub = { ...ZERO_SUB, sharesSold: 400, expiredShares: 1000 };
    render(<FutureActivityLedger model={model({ groups: [{ year: 2030, rows: [r], subtotal: sub }], totals: sub })} />);
    // 400 on the row, the year subtotal and the grand total.
    expect(screen.getAllByText("400").length).toBe(3);
    expect(screen.getAllByText("1,000").length).toBe(3);
  });
});
