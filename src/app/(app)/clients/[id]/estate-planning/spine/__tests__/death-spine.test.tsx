// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeathSpine } from "../death-spine";
import type { SpineData, StageTaxBreakdown } from "../lib/derive-spine-data";
import type { BeneficiaryDetail } from "../lib/derive-beneficiary-detail";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const zeroBreakdown: StageTaxBreakdown = {
  grossEstate: 0,
  maritalDeduction: 0,
  charitableDeduction: 0,
  estateAdminExpenses: 0,
  taxableEstate: 0,
  applicableExclusion: 0,
  federalEstateTax: 0,
  stateEstateTax: 0,
};

function detailWithTotal(total: number): BeneficiaryDetail {
  return {
    fromFirstDeath: {
      gross: 0,
      transfers: [],
      drains: { federal_estate_tax: 0, state_estate_tax: 0, admin_expenses: 0, debts_paid: 0 },
      net: 0,
    },
    fromSecondDeath: {
      gross: total,
      transfers: [],
      drains: { federal_estate_tax: 0, state_estate_tax: 0, admin_expenses: 0, debts_paid: 0 },
      net: total,
    },
    inTrust: [],
    total,
  };
}

const twoGrantorData: SpineData = {
  kind: "two-grantor",
  today: { year: 2026 },
  pair: {
    client: { name: "Tom", netWorth: 3_500_000 },
    spouse: { name: "Linda", netWorth: 2_000_000 },
  },
  firstDeath: {
    year: 2048,
    deceasedName: "Tom",
    tax: 120_000,
    toSpouse: 2_800_000,
    toTrusts: 0,
    toHeirs: 0,
    drainAttributions: [],
    transfers: [],
    taxBreakdown: zeroBreakdown,
  },
  combined: { value: 4_800_000 },
  secondDeath: {
    year: 2054,
    deceasedName: "Linda",
    tax: 450_000,
    toTrusts: 0,
    toHeirs: 4_350_000,
    drainAttributions: [],
    transfers: [],
    taxBreakdown: zeroBreakdown,
  },
  beneficiaries: [
    {
      name: "Daughter Jane",
      relationship: "child",
      isTrustRemainder: false,
      pctOfHeirs: 0.5,
      detail: detailWithTotal(2_175_000),
    },
    {
      name: "Son Mike",
      relationship: "child",
      isTrustRemainder: false,
      pctOfHeirs: 0.5,
      detail: detailWithTotal(2_175_000),
    },
  ],
  entities: [],
  totals: { taxesAndExpenses: 570_000, toHeirs: 4_350_000 },
};

const singleGrantorData: SpineData = {
  kind: "single-grantor",
  survivorName: "Tom",
  today: { year: 2026 },
  death: {
    year: 2051,
    tax: 300_000,
    toTrusts: 0,
    toHeirs: 2_700_000,
    drainAttributions: [],
    transfers: [],
    taxBreakdown: zeroBreakdown,
  },
  beneficiaries: [
    {
      name: "Daughter Jane",
      relationship: "child",
      isTrustRemainder: false,
      pctOfHeirs: 0.5,
      detail: detailWithTotal(1_350_000),
    },
  ],
  entities: [],
  totals: { taxesAndExpenses: 300_000, toHeirs: 2_700_000 },
};

const historicalData: SpineData = {
  kind: "historical",
  message: "Both grantors have passed; estate plan is historical.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DeathSpine", () => {
  it("renders two-grantor variant with all primitives", () => {
    render(<DeathSpine data={twoGrantorData} />);

    // TimelineTick: "TODAY" label and year in separate spans
    expect(screen.getByText(/TODAY/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    // PairRow: Tom's and Linda's net worth cards — two "Net Worth" elements
    expect(screen.getAllByText(/Net Worth/).length).toBeGreaterThanOrEqual(2);

    // First death TimelineTick: anchors the inheritance-to-spouse band so the
    // user can see WHEN the marital transfer happens.
    expect(screen.getByText(/FIRST DEATH · TOM/)).toBeInTheDocument();
    expect(screen.getByText(/2048/)).toBeInTheDocument();

    // Second death TimelineTick: label contains "SECOND DEATH · LINDA"
    expect(screen.getByText(/SECOND DEATH · LINDA/)).toBeInTheDocument();
    expect(screen.getByText(/2054/)).toBeInTheDocument();
  });

  it("renders single-grantor variant", () => {
    render(<DeathSpine data={singleGrantorData} />);

    // TODAY tick should appear
    expect(screen.getByText(/TODAY/)).toBeInTheDocument();

    // Single-grantor does not show a PairRow (no combined net worth comparison)
    // so "Net Worth" should NOT be in the DOM
    expect(screen.queryByText(/Net Worth/)).toBeNull();
  });

  it("renders historical empty state", () => {
    render(<DeathSpine data={historicalData} />);
    expect(screen.getByText(/historical/)).toBeInTheDocument();
  });
});
