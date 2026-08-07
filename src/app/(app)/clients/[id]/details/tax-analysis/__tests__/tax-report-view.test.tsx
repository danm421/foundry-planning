// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxReportView } from "../tax-report-view";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj, landlordSingle } from "@/lib/tax-analysis/__tests__/fixtures";
import type { YearDetail } from "../tax-analysis-content";

const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
const analysis = buildTaxAnalysis({ facts: retireeMfj(), prior: null, resolver, primaryAge: 72, spouseAge: 72 });

const detail: YearDetail = {
  taxYear: 2025, status: "ready", facts: retireeMfj(), extractedFacts: retireeMfj(),
  warnings: [], analysis, documents: [], conflicts: [], provenance: {},
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
    // $90,000 twice: the as-filed 4b amount and its 4a gross (equal here).
    expect(screen.getAllByText("$90,000")).toHaveLength(2);
    expect(screen.getByText("45.5%")).toBeTruthy(); // 90000 / 198000 gross
  });

  it("renders the deductions table including the SALT-lost-to-cap row for an itemized return", () => {
    const facts = highEarnerMfj();
    const a = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 45, spouseAge: 45 });
    const d: YearDetail = {
      taxYear: 2025, status: "ready", facts, extractedFacts: facts, warnings: [], analysis: a,
      documents: [], conflicts: [], provenance: {},
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

describe("TaxReportView — business & rental detail", () => {
  function landlordDetail(): YearDetail {
    const facts = landlordSingle();
    return {
      taxYear: 2025, status: "ready", facts, extractedFacts: facts, warnings: [],
      analysis: buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 41, spouseAge: null }),
      documents: [], conflicts: [], provenance: {},
    };
  }

  it("surfaces gross rent and the depreciation add-back that the net alone hides", () => {
    render(<TaxReportView clientId="c1" detail={landlordDetail()} onEditFacts={vi.fn()} />);
    expect(screen.getByText(/business & rental detail/i)).toBeTruthy();
    expect(screen.getByText("Rental real estate")).toBeTruthy();
    expect(screen.getByText("Rents received")).toBeTruthy();
    // $19,600 twice: the activity card's gross rent and the composition table's
    // Gross column for the same rental.
    expect(screen.getAllByText("$19,600")).toHaveLength(2);
    expect(screen.getByText("-$25,741")).toBeTruthy();     // total expenses
    expect(screen.getByText("Net taxable")).toBeTruthy();
    expect(screen.getByText("Cash flow before depreciation")).toBeTruthy();
    expect(screen.getByText("$2,272")).toBeTruthy();       // -6,141 + 8,413
  });

  it("still renders the net in the income composition table — the section adds, never replaces", () => {
    render(<TaxReportView clientId="c1" detail={landlordDetail()} onEditFacts={vi.fn()} />);
    expect(screen.getByText("Rental / passthrough (Sch E)")).toBeTruthy();
    // -$6,141 appears twice: the composition row and the activity net row.
    expect(screen.getAllByText("-$6,141")).toHaveLength(2);
  });

  it("omits the section entirely for a return with no business or rental activity", () => {
    render(<TaxReportView clientId="c1" detail={detail} onEditFacts={vi.fn()} />);
    expect(screen.queryByText(/business & rental detail/i)).toBeNull();
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
      documents: [], conflicts: [], provenance: {},
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

describe("TaxReportView — gross income top line", () => {
  function detailFor(facts: ReturnType<typeof landlordSingle>, age: number): YearDetail {
    return {
      taxYear: 2025, status: "ready", facts, extractedFacts: facts, warnings: [],
      analysis: buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: age, spouseAge: null }),
      documents: [], conflicts: [], provenance: {},
    };
  }

  it("shows a Gross income KPI of rents received rather than the netted line 9", () => {
    render(<TaxReportView clientId="c1" detail={detailFor(landlordSingle(), 41)} onEditFacts={vi.fn()} />);
    expect(screen.getByText("Gross income")).toBeTruthy();
    // 118,546 (line 9) + 6,141 rental loss + 19,600 rents received. Twice: the
    // KPI tile and the composition table's Gross total — proving both read it.
    expect(screen.getAllByText("$144,287")).toHaveLength(2);
    // Line 9 still shown as filed (Total income KPI, AGI KPI, total-row cell).
    expect(screen.getAllByText("$118,546").length).toBeGreaterThan(0);
  });

  it("widens the composition table to As filed / Gross and rebases the % on gross", () => {
    render(<TaxReportView clientId="c1" detail={detailFor(landlordSingle(), 41)} onEditFacts={vi.fn()} />);
    expect(screen.getByText("As filed")).toBeTruthy();
    expect(screen.getByText("Gross")).toBeTruthy();
    expect(screen.getByText("% of gross")).toBeTruthy();
    expect(screen.queryByText("% of total")).toBeNull();
    // The defect this replaces: wages read 105.1% of line 9. 124,624/144,287.
    expect(screen.getByText("86.4%")).toBeTruthy();
    expect(screen.queryByText("105.1%")).toBeNull();
  });

  it("keeps the three-column table and hides the tile when nothing grosses up", () => {
    const facts = highEarnerMfj();
    facts.income.totalIncome = 467000;
    render(<TaxReportView clientId="c1" detail={detailFor(facts, 45)} onEditFacts={vi.fn()} />);
    expect(screen.queryByText("Gross income")).toBeNull();
    expect(screen.queryByText("Gross")).toBeNull();
    expect(screen.getByText("Amount")).toBeTruthy();
    expect(screen.getByText("% of total")).toBeTruthy();
  });
});
