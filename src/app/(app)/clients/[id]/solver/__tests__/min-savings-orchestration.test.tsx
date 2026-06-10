// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
// Also capture the onResult callback so tests can fire simulated solve results.
const startMock = vi.fn<(args: StartArgs) => Promise<void>>();

// Module-scope holder for the captured onResult; assigned inside the factory
// at render time (not at hoist time), so no TDZ issue.
let capturedOnResult: ((e: unknown) => void) | undefined;

vi.mock("../use-solver-solve", () => ({
  useSolverSolve: (opts: { onResult?: (e: unknown) => void }) => {
    capturedOnResult = opts.onResult;
    return {
      status: "idle",
      errorMessage: null,
      start: startMock,
      cancel: vi.fn(),
    };
  },
}));

beforeEach(() => {
  startMock.mockReset();
  startMock.mockResolvedValue(undefined);
  capturedOnResult = undefined;
  vi.stubGlobal("fetch", vi.fn());
});

const portfolio = {
  id: "p1",
  name: "Balanced 60/40",
  growthRate: 0.05,
  realization: {
    pctOrdinaryIncome: 0,
    pctLtCapitalGains: 0.85,
    pctQualifiedDividends: 0.15,
    pctTaxExempt: 0,
    turnoverPct: 0,
  },
  mix: [{ assetClassId: "ac-1", weight: 1 }],
};

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

const baseProjectionYear = {
  year: 2026,
  portfolioAssets: { total: 1_000_000 },
  expenses: { living: 100_000 },
} as never;

const baseProps = {
  clientId: "client-id",
  baseClientData,
  baseProjection: [baseProjectionYear],
  initialSource: "base" as const,
  initialSourceClientData: baseClientData,
  initialSourceProjection: [baseProjectionYear],
  availableScenarios: [],
  modelPortfolios: [portfolio],
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
    scenarioRef: "base",
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
    fireEvent.click(
      screen.getAllByRole("button", { name: /Solve minimum additional savings/i })[0],
    );
    // Config box opens — click the "Solve" submit (only ONE instance since the
    // box is local state in one panel copy).
    fireEvent.click(screen.getByRole("button", { name: /^Solve$/i }));

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

    // Portfolio growth rate flowed through to the synthetic account.
    expect(
      acctMut?.kind === "account-upsert" && acctMut.value?.growthRate,
    ).toBeCloseTo(0.05);

    // Portfolio mix is on the first solve's extraAccountMixes (guards against
    // the regression where extraAccountMixes was empty on first solve).
    expect(args.extraAccountMixes?.[0]?.mix).toEqual([
      { assetClassId: "ac-1", weight: 1 },
    ]);
  });

  it("shows the outcome and 'Keep self-funding' surfaces the savings box", async () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    // Open config box then submit.
    fireEvent.click(
      screen.getAllByRole("button", { name: /Solve minimum additional savings/i })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: /^Solve$/i }));

    // Verify solve was kicked off and capturedOnResult is ready.
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(typeof capturedOnResult).toBe("function");

    // Drive the converged result through the captured callback.
    // finalProjection must include portfolioAssets so the liquidPortfolioTotal
    // mock (which reads .portfolioAssets.total) doesn't throw on re-render.
    act(() => {
      capturedOnResult?.({
        objective: "pos",
        status: "converged",
        solvedValue: 24500,
        achievedPoS: 0.85,
        canonicalPoS: 0.86,
        iterations: 5,
        seed: 1,
        finalProjection: [
          {
            year: 2026,
            portfolioAssets: { total: 1_000_000 },
            expenses: { living: 108300 },
            hypotheticalSavings: {
              contribution: 24500,
              fromCashFlow: 12800,
              fromExpenseReduction: 11700,
            },
          },
        ],
      } as never);
    });

    // Outcome panel renders (appears in both panel copies → findAllByText).
    expect((await screen.findAllByText(/24,500/)).length).toBeGreaterThan(0);

    // Click "Keep self-funding" (first copy) → the Additional Savings box appears.
    fireEvent.click(
      screen.getAllByRole("button", { name: /Keep self-funding/i })[0],
    );
    expect(
      (await screen.findAllByLabelText("Additional Savings")).length,
    ).toBeGreaterThan(0);
  });
});
