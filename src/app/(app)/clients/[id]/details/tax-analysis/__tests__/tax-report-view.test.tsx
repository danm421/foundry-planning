// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxReportView } from "../tax-report-view";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj } from "@/lib/tax-analysis/__tests__/fixtures";
import type { YearDetail } from "../tax-analysis-content";

const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
const analysis = buildTaxAnalysis({ facts: retireeMfj(), prior: null, resolver, primaryAge: 72, spouseAge: 72 });

const detail: YearDetail = {
  taxYear: 2025, status: "ready", facts: retireeMfj(), extractedFacts: retireeMfj(),
  warnings: [], analysis,
};

describe("TaxReportView", () => {
  it("renders key figures, observations grouped by severity, and the bracket bars", () => {
    render(<TaxReportView clientId="c1" detail={detail} onEditFacts={vi.fn()} />);
    expect(screen.getByText("$188,700")).toBeTruthy(); // AGI
    expect(screen.getByText(/opportunities/i)).toBeTruthy();
    expect(screen.getByText(/roth conversion headroom/i)).toBeTruthy();
    expect(screen.getByTestId("bracket-map")).toBeTruthy();
    expect(screen.getByText(/not tax advice/i)).toBeTruthy();
  });
});

describe("TaxReportView — income composition + deductions", () => {
  it("renders the income composition table with formatted amounts and percentages", () => {
    render(<TaxReportView clientId="c1" detail={detail} onEditFacts={vi.fn()} />);
    expect(screen.getByText(/income composition/i)).toBeTruthy();
    expect(screen.getByText("IRA distributions")).toBeTruthy();
    expect(screen.getByText("$90,000")).toBeTruthy();
    expect(screen.getByText("47.7%")).toBeTruthy(); // 90000 / 188700
  });

  it("renders the deductions table including the SALT-lost-to-cap row for an itemized return", () => {
    const facts = highEarnerMfj();
    const a = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 45, spouseAge: 45 });
    const d: YearDetail = {
      taxYear: 2025, status: "ready", facts, extractedFacts: facts, warnings: [], analysis: a,
    };
    render(<TaxReportView clientId="c1" detail={d} onEditFacts={vi.fn()} />);
    expect(screen.getByText(/^deductions$/i)).toBeTruthy();
    expect(screen.getByText("Itemized")).toBeTruthy();
    expect(screen.getByText("SALT lost to the cap")).toBeTruthy();
    // Both "SALT lost to the cap" and "Mortgage interest" are $22,000 for
    // this fixture — getByText would throw on the duplicate.
    expect(screen.getAllByText("$22,000").length).toBeGreaterThan(0);
  });
});

describe("TaxReportView — total income", () => {
  it("renders the Total income KPI and a composition total row when line 9 is present", () => {
    const facts = retireeMfj();
    facts.income.totalIncome = 195700; // distinct from AGI 188700
    facts.income.adjustmentsToIncome = 7000;
    const a = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 72, spouseAge: 72 });
    const d: YearDetail = {
      taxYear: 2025, status: "ready", facts, extractedFacts: facts, warnings: [], analysis: a,
    };
    render(<TaxReportView clientId="c1" detail={d} onEditFacts={vi.fn()} />);
    // "Total income" appears twice: the KPI label and the total-row label.
    expect(screen.getAllByText("Total income")).toHaveLength(2);
    // $195,700 appears twice: the KPI value and the total-row amount — proves
    // both surfaces read line 9, not AGI.
    expect(screen.getAllByText("$195,700")).toHaveLength(2);
    expect(screen.getByText("$188,700")).toBeTruthy(); // AGI KPI still distinct
    expect(screen.getByText("100%")).toBeTruthy();      // total-row %
  });

  it("omits the total row (and shows no 100% row) when line 9 was not extracted", () => {
    render(<TaxReportView clientId="c1" detail={detail} onEditFacts={vi.fn()} />);
    expect(screen.getByText("Total income")).toBeTruthy(); // KPI label present (value —)
    expect(screen.queryByText("100%")).toBeNull();         // no total row
  });
});
