// @vitest-environment jsdom
//
// The Cash Flow → Withdrawals drill's Withdrawal % counts everything a QCD took
// out of the IRA: the qualifying part AND the taxed excess over the yearly cap,
// which sits in neither `rmdAmount` nor `qcdAmount`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import CashFlowReport from "../cashflow-report";
import { CHECKING } from "@/engine/__tests__/_fixtures/margin";
import { buildClientData, basePlanSettings, baseClient, sampleFamilyMembers } from "@/engine/__tests__/fixtures";
import { runProjection } from "@/engine/projection";
import { liquidPortfolioBoy } from "@/engine/portfolio-snapshot";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import type { Account } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/cashflow",
  useSearchParams: () => new URLSearchParams("view=withdrawals"),
}));
vi.mock("react-chartjs-2", () => ({ Bar: () => null, Chart: () => null }));
vi.mock("@/components/cashflow/charts/drill-chart", () => ({ DrillChart: () => null }));
vi.mock("@/components/exports/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/charts/portfolio-bars-chart", () => ({ PortfolioBarsChart: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IRA: Account = {
  id: "acct-ira", name: "Client IRA", category: "retirement", subType: "traditional_ira",
  titlingType: "jtwros", value: 2_000_000, basis: 0, growthRate: 0, rmdEnabled: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("Cash Flow — Withdrawal % with a QCD", () => {
  it("counts a QCD's taxed excess in the Withdrawal %", async () => {
    // 75 in 2026; $150,000 to charity against the $111,000 cap → $39,000 taxed excess.
    const dob = "1951-01-01";
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: dob },
      familyMembers: [{ ...sampleFamilyMembers[0], dateOfBirth: dob }],
      accounts: [{ ...CHECKING, value: 500_000, basis: 500_000 }, IRA],
      incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
      externalBeneficiaries: [{ id: "ch", name: "Red Cross", kind: "charity", charityType: "public" }],
      qcds: [{ year: 2026, accountId: "acct-ira", charityId: "ch", mode: "fixed", amount: 150_000 }],
      planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, planStartYear: 2026, planEndYear: 2027 },
    });

    // The expected figure, worked from the projection the report runs.
    const years = runProjection(data);
    const y = years[0];
    expect(y.qcds?.[0]).toMatchObject({ qualifying: 111_000, taxedExcess: 39_000 });
    const rmd = Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);
    const pct = (n: number) => `${((n / liquidPortfolioBoy(y, years)) * 100).toFixed(2)}%`;
    const withExcess = pct(y.withdrawals.total + rmd + 150_000);
    const withoutExcess = pct(y.withdrawals.total + rmd + 111_000);
    expect(withExcess).not.toBe(withoutExcess);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
    render(<CashFlowReport clientId="c1" />);
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("2026"));
    expect(row).toBeDefined();
    expect(within(row!).getByText(withExcess)).toBeInTheDocument();
  });
});
