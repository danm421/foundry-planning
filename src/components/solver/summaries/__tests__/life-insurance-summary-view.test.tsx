// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LifeInsuranceSummaryView } from "../life-insurance-summary-view";
import type { LifeInsuranceSummaryPageData } from "@/lib/presentations/pages/life-insurance-summary/view-model";

// ── Case (a): notSolved = true (v1 default) ───────────────────────────────────
const NOT_SOLVED: LifeInsuranceSummaryPageData = {
  title: "Life Insurance Summary",
  subtitle: "In-force coverage · Base scenario",
  isEmpty: false,
  notSolved: true,
  married: false,
  totals: {
    count: 2,
    deathBenefit: 1_500_000,
    cashValue: 120_000,
    premium: 4_200,
  },
  policies: [
    {
      accountId: "acct-1",
      name: "20-Year Term",
      policyType: "term",
      ownerLabel: "Jordan Avery",
      insuredLabel: "Jordan Avery",
      insuredPerson: "client",
      deathBenefit: 1_000_000,
      cashValue: 0,
      premiumAmount: 2_400,
      termExpiryYear: 2038,
      carrier: "Protective",
      beneficiaries: [
        { tier: "primary", name: "Riley Avery", percentage: 100 },
      ],
    },
    {
      accountId: "acct-2",
      name: "Whole Life",
      policyType: "whole",
      ownerLabel: "Jordan Avery",
      insuredLabel: "Jordan Avery",
      insuredPerson: "client",
      deathBenefit: 500_000,
      cashValue: 120_000,
      premiumAmount: 1_800,
      termExpiryYear: null,
      carrier: "MassMutual",
      beneficiaries: [
        { tier: "primary", name: "Riley Avery", percentage: 60 },
        { tier: "contingent", name: "Casey Avery", percentage: 40 },
      ],
    },
  ],
  clientGap: null,
  spouseGap: null,
  chart: { rows: [], markYear: null, clientCoverageLine: 1_500_000, spouseCoverageLine: null },
  jointFootnote: false,
  narrative: [
    "2 in-force policies totalling $1.5M in death benefit.",
    "Run the life insurance solver to evaluate coverage against need.",
  ],
};

// ── Case (b): notSolved = false, gap + chart present ──────────────────────────
const SOLVED: LifeInsuranceSummaryPageData = {
  title: "Life Insurance Summary",
  subtitle: "Solved for death in 2040 · proceeds → 60/40 · 85% MC target",
  isEmpty: false,
  notSolved: false,
  married: true,
  totals: {
    count: 2,
    deathBenefit: 1_500_000,
    cashValue: 120_000,
    premium: 4_200,
  },
  policies: [
    {
      accountId: "acct-1",
      name: "20-Year Term",
      policyType: "term",
      ownerLabel: "Jordan Avery",
      insuredLabel: "Jordan Avery",
      insuredPerson: "client",
      deathBenefit: 1_000_000,
      cashValue: 0,
      premiumAmount: 2_400,
      termExpiryYear: 2038,
      carrier: "Protective",
      beneficiaries: [{ tier: "primary", name: "Riley Avery", percentage: 100 }],
    },
    {
      accountId: "acct-2",
      name: "Spouse Term",
      policyType: "term",
      ownerLabel: "Riley Avery",
      insuredLabel: "Riley Avery",
      insuredPerson: "spouse",
      deathBenefit: 500_000,
      cashValue: 0,
      premiumAmount: 1_800,
      termExpiryYear: 2040,
      carrier: "Lincoln",
      beneficiaries: [{ tier: "primary", name: "Jordan Avery", percentage: 100 }],
    },
  ],
  clientGap: {
    decedentLabel: "Jordan Avery",
    have: 1_000_000,
    need: 1_800_000,
    gap: { kind: "shortfall", amount: 800_000 },
    exceedsCap: false,
    hasJoint: false,
  },
  spouseGap: {
    decedentLabel: "Riley Avery",
    have: 500_000,
    need: 400_000,
    gap: { kind: "surplus", amount: 100_000 },
    exceedsCap: false,
    hasJoint: false,
  },
  chart: {
    rows: [
      { year: 2027, clientNeed: 1_800_000, spouseNeed: 400_000 },
      { year: 2030, clientNeed: 1_600_000, spouseNeed: 350_000 },
      { year: 2035, clientNeed: 1_200_000, spouseNeed: 200_000 },
      { year: 2040, clientNeed: 800_000, spouseNeed: null },
    ],
    markYear: 2040,
    clientCoverageLine: 1_000_000,
    spouseCoverageLine: 500_000,
  },
  jointFootnote: false,
  narrative: [
    "Jordan Avery is under-insured: $1.0M coverage vs $1.8M need — a $800k shortfall.",
    "Riley Avery has adequate coverage: $500k vs $400k need.",
  ],
};

describe("LifeInsuranceSummaryView", () => {
  // ── Case (a): notSolved = true ────────────────────────────────────────────
  it("renders inventory and solver hint when notSolved is true (v1 default)", () => {
    const { container } = render(<LifeInsuranceSummaryView data={NOT_SOLVED} />);
    const text = container.textContent ?? "";

    // Title + subtitle
    expect(text).toContain("Life Insurance Summary");
    expect(text).toContain("In-force coverage");

    // KPI row — totals
    expect(text).toContain("2"); // policy count
    expect(text).toContain("$1.5M"); // death benefit
    expect(text).toContain("$120k"); // cash value

    // Policies table — both policies present
    expect(text).toContain("20-Year Term");
    expect(text).toContain("Whole Life");

    // Solver hint — must appear when notSolved
    expect(text).toContain("Run the solver to see coverage-vs-need.");

    // Narrative
    expect(text).toContain("2 in-force policies totalling $1.5M in death benefit.");
  });

  // ── Case (b): notSolved = false, gap + chart ──────────────────────────────
  it("renders coverage-vs-need cards and chart section when notSolved is false", () => {
    const { container } = render(<LifeInsuranceSummaryView data={SOLVED} />);
    const text = container.textContent ?? "";

    // Coverage-vs-need cards
    expect(text).toContain("Jordan Avery");
    expect(text).toContain("Shortfall");
    expect(text).toContain("Riley Avery");
    expect(text).toContain("Surplus");

    // Chart section heading
    expect(text).toContain("Life insurance need over time");

    // Narrative
    expect(text).toContain("Jordan Avery is under-insured");

    // notSolved hint must NOT appear
    expect(text).not.toContain("Run the solver to see coverage-vs-need.");
  });

  // ── Case (c): isEmpty = true ──────────────────────────────────────────────
  it("renders the empty state when isEmpty is true", () => {
    const data = { isEmpty: true, title: "Life Insurance Summary", subtitle: "" } as never;
    const { getByText } = render(<LifeInsuranceSummaryView data={data} />);
    expect(getByText("No data for this scenario yet.")).toBeTruthy();
  });
});
