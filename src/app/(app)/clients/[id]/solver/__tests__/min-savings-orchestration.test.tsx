// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LiveSolverWorkspace } from "../live-solver-workspace";
import type { StartArgs } from "../use-solver-solve";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/charts/portfolio-bars-chart", () => ({
  PortfolioBarsChart: () => <div data-testid="chart" />,
  liquidPortfolioTotal: (y: { portfolioAssets: { total: number } }) =>
    y.portfolioAssets.total,
}));

// Capture what the solve controller's start() is called with, without any
// network/SSE. The workspace drives start() imperatively, so this is the
// cleanest observable for the target lever + baseline mutations.
const startMock = vi.fn<(args: StartArgs) => Promise<void>>();
vi.mock("../use-solver-solve", () => ({
  useSolverSolve: () => ({
    status: "idle",
    errorMessage: null,
    start: startMock,
    cancel: vi.fn(),
  }),
}));

beforeEach(() => {
  startMock.mockReset();
  startMock.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});

const baseClientData = {
  client: {
    firstName: "Cooper",
    lastName: "Smith",
    dateOfBirth: "1965-03-15",
    retirementAge: 65,
    retirementMonth: 1,
    planEndAge: 95,
    filingStatus: "single",
  },
  familyMembers: [{ id: "fm-client", role: "client" }],
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {},
} as never;

const baseProps = {
  clientId: "client-id",
  baseClientData,
  baseProjection: [{ year: 2026, portfolioAssets: { total: 1_000_000 } }] as never,
  initialSource: "base" as const,
  initialSourceClientData: baseClientData,
  initialSourceProjection: [
    { year: 2026, portfolioAssets: { total: 1_000_000 } },
  ] as never,
  availableScenarios: [],
  modelPortfolios: [],
  milestones: {
    planStart: 2026,
    planEnd: 2056,
    clientRetirement: 2030,
    clientEnd: 2060,
  },
  lifeInsuranceSettings: {
    deathYear: 2030,
    modelPortfolioId: null,
    leaveToHeirsAmount: 0,
    livingExpenseAtDeath: null,
    payoffLiabilityIds: [],
    mcTargetScore: 0.9,
    coverEstateTaxes: false,
  },
  clientName: "Cooper",
  spouseName: "Spouse",
  categoryGrowthDefaults: { taxable: 0.06, retirement: 0.06, cash: 0.02 },
};

describe("LiveSolverWorkspace — solve minimum additional savings", () => {
  it("pushes the account + rule into the solve baseline and targets the new account", () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    // The compare grid renders the editing surface twice (visible + a measured
    // copy), so the button appears more than once; clicking either drives the
    // same handler.
    const buttons = screen.getAllByRole("button", {
      name: /Solve minimum additional savings/i,
    });
    fireEvent.click(buttons[0]);

    expect(startMock).toHaveBeenCalledTimes(1);
    const args = startMock.mock.calls[0][0];

    // Target lever is the newly-created account.
    expect(args.target.kind).toBe("savings-contribution");
    const accountId =
      args.target.kind === "savings-contribution" ? args.target.accountId : "";
    expect(accountId).toBeTruthy();

    // Baseline carries a real taxable "Additional Savings" account...
    const acctMut = args.mutations.find((m) => m.kind === "account-upsert");
    expect(acctMut).toBeTruthy();
    expect(acctMut?.kind === "account-upsert" && acctMut.value).toMatchObject({
      category: "taxable",
      name: "Additional Savings",
    });
    expect(acctMut?.kind === "account-upsert" && acctMut.id).toBe(accountId);

    // ...and a fundFromExpenseReduction savings rule for that same account.
    const ruleMut = args.mutations.find((m) => m.kind === "savings-rule-upsert");
    expect(ruleMut).toBeTruthy();
    expect(ruleMut?.kind === "savings-rule-upsert" && ruleMut.value).toMatchObject({
      accountId,
      annualAmount: 0,
      fundFromExpenseReduction: true,
    });

    // Default target PoS matches the per-lever popovers (85%).
    expect(args.targetPoS).toBeCloseTo(0.85);
  });
});
