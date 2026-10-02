// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import IncomeTaxReport from "../income-tax-report";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/cashflow/charts/tax-tab-chart", () => ({ TaxTabChart: () => null }));
// Stand-in for the tables: shows which years and which lifespan it was handed.
vi.mock("@/components/cashflow/tax-detail-view", () => ({
  TAX_DETAIL_TABS: [{ id: "income", label: "Income Breakdown" }],
  TaxDetailView: (p: { years: { year: number }[]; planEndYear: number; clientLifeExpectancy?: number }) => (
    <div
      data-testid="tax-detail"
      data-last-year={p.years.at(-1)?.year}
      data-plan-end={p.planEndYear}
      data-client-le={p.clientLifeExpectancy}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Income Tax report under an LTC scenario", () => {
  it("runs through the care-extended years and reads the care-shortened lifespan", async () => {
    // John (1970) in care 2055–2057; Jane dies 2052, so the raw plan ends 2055.
    const data = buildClientData({
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 80 },
      planSettings: { ...basePlanSettings, planEndYear: 2055 },
      ltcEvents: [
        {
          id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566", name: "LTC", livingExpenseCutPct: null, homeSale: null,
          includePolicies: true,
          people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
        },
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IncomeTaxReport clientId="c1" />);
    const view = await waitFor(() => screen.getByTestId("tax-detail"));
    expect(view.dataset.planEnd).toBe("2057");
    expect(view.dataset.lastYear).toBe("2057"); // the care years carrying the medical deduction
    expect(view.dataset.clientLe).toBe("87");
  });
});
