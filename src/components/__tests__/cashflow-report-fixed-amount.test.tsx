// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import CashFlowReport from "../cashflow-report";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { Income } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/cashflow",
  useSearchParams: () => new URLSearchParams("view=income"),
}));
vi.mock("react-chartjs-2", () => ({ Bar: () => null, Chart: () => null }));
vi.mock("@/components/cashflow/charts/drill-chart", () => ({ DrillChart: () => null }));
vi.mock("@/components/exports/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/charts/portfolio-bars-chart", () => ({ PortfolioBarsChart: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ss = (over: Partial<Income>): Income => ({
  id: "ss", type: "social_security", name: "Social Security", annualAmount: 0,
  startYear: 2026, endYear: 2099, growthRate: 0, owner: "client",
  claimingAgeMode: "years", claimingAge: 67, claimingAgeMonths: 0, ...over,
} as Income);

describe("Cash Flow Social Security drill", () => {
  it("labels the leftover column 'Fixed amount' for a row the engine cannot price off a PIA", async () => {
    // John's PIA row gets Retirement columns; Jane's year-by-year schedule is
    // paid as literal dollars, so only the leftover column can carry it.
    const data = buildClientData({
      incomes: [
        ss({ id: "ss-john", ssBenefitMode: "pia_at_fra", piaMonthly: 3000 }),
        ss({
          id: "ss-jane", owner: "spouse", ssBenefitMode: "manual_amount",
          scheduleOverrides: { 2040: 20_000, 2041: 21_000 },
        }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
    render(<CashFlowReport clientId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Social Security/ }));
    await waitFor(() => expect(screen.getAllByText("Fixed amount").length).toBeGreaterThan(0));
    expect(screen.queryByText("Manual / Legacy SS")).toBeNull();
  });
});
