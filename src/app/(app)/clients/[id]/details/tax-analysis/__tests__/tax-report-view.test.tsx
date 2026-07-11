// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxReportView } from "../tax-report-view";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj } from "@/lib/tax-analysis/__tests__/fixtures";
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
