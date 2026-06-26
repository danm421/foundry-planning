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
  // Open the min-savings config box (the compare grid renders the trigger twice
  // — visible + a measured copy — so click either) and submit the default solve.
  const openAndSolve = () => {
    fireEvent.click(
      screen.getAllByRole("button", { name: /Solve minimum additional savings/i })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: /^Solve$/i }));
  };

  // A converged min-savings result. The accountId isn't carried in the event —
  // the workspace resolves it from its own ref — so the same payload drives
  // whichever solve is in flight. finalProjection must include portfolioAssets
  // so the liquidPortfolioTotal mock doesn't throw on re-render.
  const convergedEvent = {
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
  };

  it("pushes the account + rule into the solve baseline and targets the new account", () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    openAndSolve();

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

    openAndSolve();

    // Verify solve was kicked off and capturedOnResult is ready.
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(typeof capturedOnResult).toBe("function");

    // Drive the converged result through the captured callback.
    act(() => capturedOnResult?.(convergedEvent as never));

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

  it("Dismiss discards the uncommitted account; re-solving doesn't accumulate", () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    // Solve #1 → converged → Dismiss.
    openAndSolve();
    const firstAccountId =
      startMock.mock.calls[0][0].target.kind === "savings-contribution"
        ? startMock.mock.calls[0][0].target.accountId
        : "";
    act(() => capturedOnResult?.(convergedEvent as never));
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));

    // Solve #2 → mints a fresh account.
    openAndSolve();
    expect(startMock).toHaveBeenCalledTimes(2);
    const secondArgs = startMock.mock.calls[1][0];
    const secondAccountId =
      secondArgs.target.kind === "savings-contribution" ? secondArgs.target.accountId : "";
    expect(secondAccountId).toBeTruthy();
    expect(secondAccountId).not.toBe(firstAccountId);

    // The dismissed account was retired (account-upsert → null) in the baseline,
    // and exactly ONE live synthetic account (the new one) remains — no stacking.
    const retired = secondArgs.mutations.find(
      (m) => m.kind === "account-upsert" && m.id === firstAccountId,
    );
    expect(retired?.kind === "account-upsert" && retired.value).toBeNull();

    const liveAccountIds = secondArgs.mutations
      .filter((m) => m.kind === "account-upsert" && m.value !== null)
      .map((m) => (m.kind === "account-upsert" ? m.id : ""));
    expect(liveAccountIds).toEqual([secondAccountId]);
  });

  it("after committing one account, re-solve + Keep self-funding surfaces the SECOND account", async () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    // Solve #1 → converged → Keep self-funding (commits the first account).
    openAndSolve();
    act(() => capturedOnResult?.(convergedEvent as never));
    fireEvent.click(screen.getAllByRole("button", { name: /Keep self-funding/i })[0]);
    const afterFirst = (await screen.findAllByLabelText("Additional Savings")).length;
    expect(afterFirst).toBeGreaterThan(0);

    // Solve #2 → converged → Keep self-funding again. The include handler must
    // target THIS solve's account (the ref), not `.find(fundFromExpenseReduction)`
    // which grabs the already-committed first account, so a NEW box appears.
    openAndSolve();
    act(() => capturedOnResult?.(convergedEvent as never));
    fireEvent.click(screen.getAllByRole("button", { name: /Keep self-funding/i })[0]);

    const afterSecond = (await screen.findAllByLabelText("Additional Savings")).length;
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });
});
