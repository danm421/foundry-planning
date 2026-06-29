// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MedicareTab } from "@/components/cashflow/medicare/medicare-tab";

// Stub heavy children so the test isolates MedicareTab's own empty-state branch.
// Without these stubs, the children throw on the minimal fake year fixture
// (missing medicare/taxResult fields, Chart.js canvas, etc.).
vi.mock("../medicare-magi-tier-chart", () => ({ MedicareMagiTierChart: () => null }));
vi.mock("../medicare-year-table", () => ({ MedicareYearTable: () => null }));
vi.mock("../medicare-callouts", () => ({ MedicareCallouts: () => null }));
vi.mock("../medicare-drill-down-modal", () => ({ MedicareDrillDownModal: () => null }));
vi.mock("../medicare-inflation-controls", () => ({ MedicareInflationControls: () => null }));

describe("MedicareTab empty-state CTA", () => {
  it("shows the Enable Medicare modeling CTA when coverage is empty", () => {
    render(
      <MedicareTab
        years={[]}
        yearRange={[2026, 2050]}
        clientData={{ medicareCoverage: [] } as never}
        clientId="c1"
        onEnableMedicare={() => {}}
      />,
    );
    expect(screen.getByText(/enable medicare modeling/i)).toBeInTheDocument();
  });

  it("does NOT show the CTA when coverage exists", () => {
    render(
      <MedicareTab
        years={[{ year: 2026, ages: { client: 74, spouse: 75 } } as never]}
        yearRange={[2026, 2050]}
        clientData={{ medicareCoverage: [{ owner: "client" }] } as never}
        clientId="c1"
        onEnableMedicare={() => {}}
      />,
    );
    expect(screen.queryByText(/enable medicare modeling/i)).not.toBeInTheDocument();
  });
});
