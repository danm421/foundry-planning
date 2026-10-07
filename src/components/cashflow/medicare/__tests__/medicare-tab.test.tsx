// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MedicareTab } from "@/components/cashflow/medicare/medicare-tab";

// Stub heavy children so the test isolates MedicareTab's own branching.
// Without these stubs, the children throw on the minimal fake year fixture
// (missing medicare/taxResult fields, Chart.js canvas, etc.).
vi.mock("../medicare-magi-tier-chart", () => ({ MedicareMagiTierChart: () => null }));
vi.mock("../medicare-year-table", () => ({ MedicareYearTable: () => <div data-testid="year-table" /> }));
vi.mock("../medicare-callouts", () => ({ MedicareCallouts: () => null }));
vi.mock("../medicare-drill-down-modal", () => ({ MedicareDrillDownModal: () => null }));
vi.mock("../medicare-inflation-controls", () => ({ MedicareInflationControls: () => null }));

describe("MedicareTab", () => {
  // Medicare is modeled for everyone by default, so there is no "not set up"
  // state. The Cash Flow tax popup passes no clientData at all — it must still
  // show the projection, not a setup prompt.
  it("shows the projection for a Medicare-age household even without clientData", () => {
    render(
      <MedicareTab
        years={[{ year: 2026, ages: { client: 74, spouse: 75 } }] as never}
        yearRange={[2026, 2050]}
      />,
    );
    expect(screen.getByTestId("year-table")).toBeInTheDocument();
    expect(screen.queryByText(/not yet configured/i)).not.toBeInTheDocument();
  });

  it("shows the household estimate box checked when every person has it on", () => {
    render(
      <MedicareTab
        years={[{ year: 2026, ages: { client: 74 } }] as never}
        yearRange={[2026, 2050]}
        clientData={{ medicareCoverage: [{ owner: "client", estimatePriorYearMagiFromProjection: true }] } as never}
        clientId="c1"
        onInflationChange={() => {}}
        estimateMagi
        onEstimateMagiChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/estimate prior-year magi/i)).toBeChecked();
  });
});
