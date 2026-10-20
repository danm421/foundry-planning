// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import CashFlowReport from "../cashflow-report";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import type { Account, ClientData, Income } from "@/engine/types";

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

// Mirrors engine/__tests__/projection.entity-distribution.test.ts: a business
// held as an ACCOUNT (no entity row) paying out all its net income. The engine
// keys those distributions by the account's id.
const account = (over: Partial<Account>): Account =>
  ({ titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, ...over }) as Account;

const data: ClientData = {
  client: {
    firstName: "Alice", lastName: "Test", dateOfBirth: "1980-01-01", retirementAge: 65,
    planEndAge: 90, filingStatus: "single",
  },
  accounts: [
    account({
      id: "hh-checking", name: "Household Checking", category: "cash", subType: "checking",
      value: 100_000, basis: 100_000, isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    }),
    account({
      id: "biz-llc", name: "Consulting Business", category: "business", subType: "llc",
      businessType: "llc", parentAccountId: null, distributionPolicyPercent: 1,
      flowMode: "annual", businessTaxTreatment: "ordinary",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    }),
    account({
      id: "biz-llc-checking", name: "Consulting Business Checking", category: "cash",
      subType: "checking", parentAccountId: "biz-llc", isDefaultChecking: true,
      owners: [{ kind: "entity", entityId: "biz-llc", percent: 1 }],
    }),
  ],
  incomes: [{
    id: "biz-revenue", type: "business", name: "Consulting Revenue", annualAmount: 100_000,
    startYear: 2026, endYear: 2050, growthRate: 0, owner: "client", ownerAccountId: "biz-llc",
  } as Income],
  expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
  planSettings: {
    flatFederalRate: 0.24, flatStateRate: 0.05, inflationRate: 0,
    planStartYear: 2026, planEndYear: 2027,
  },
  familyMembers: [], entities: [], giftEvents: [],
};

describe("Cash Flow Business drill", () => {
  it("lists a business held as an account under its own name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
    render(<CashFlowReport clientId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Business/ }));
    expect(await screen.findByText("Consulting Business")).toBeTruthy();
  });
});
