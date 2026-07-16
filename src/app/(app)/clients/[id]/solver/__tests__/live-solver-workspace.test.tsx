// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { LiveSolverWorkspace } from "../live-solver-workspace";
import { resolveReportLayout } from "@/lib/solver/report-layout";

const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

// The workspace calls useToast() for the report-layout save-failure toast and
// saveReportLayout() to persist a layout change. Real usage is under the root
// <ToastProvider> plus a Clerk/DB server action; here we stub both with hoisted
// spies so the layout tests can drive + assert them (toast pattern mirrors
// balance-sheet-view-529.test.tsx).
const { showToastMock, saveReportLayoutMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  saveReportLayoutMock: vi.fn(),
}));
vi.mock("@/components/toast", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("../report-layout-actions", () => ({
  saveReportLayout: saveReportLayoutMock,
}));

// Mock the cached-endpoint MC hook so the workspace's auto-run never hits the
// network in tests. `mcStateRef.current` lets individual tests drive the gauge
// state; `mcCalls` records every invocation's enabled flag + includeBase, which
// (post-refactor) is how a first/auto run — Base + Scenario — is distinguished
// from a working-only Recalculate. `mcCalls` is a RENDER log, not a launch
// log — the hook re-renders (and re-pushes) on every parent render, so a burst
// of edits that produces one launch still yields many entries sharing that
// launch's nonce. `nonce` (the component's `mcVersion`, bumped once per
// `launchMc` call) is what turns a render log into a launch-accurate one: the
// number of DISTINCT nonces among working-only calls is the number of
// distinct launches, no matter how many renders each one causes.
const { mcStateRef, mcCalls } = vi.hoisted(() => ({
  mcStateRef: {
    current: {
      status: "idle",
      baseSuccessRate: null,
      workingSuccessRate: null,
    } as {
      status: "idle" | "loading" | "ready" | "error";
      baseSuccessRate: number | null;
      workingSuccessRate: number | null;
    },
  },
  mcCalls: [] as Array<{ enabled: boolean; includeBase: boolean; nonce: number }>,
}));
vi.mock("../use-solver-mc", () => ({
  useSolverMc: (args: { enabled: boolean; includeBase: boolean; nonce: number }) => {
    mcCalls.push({ enabled: args.enabled, includeBase: args.includeBase, nonce: args.nonce });
    return mcStateRef.current;
  },
}));

// The Net-to-Heirs KPI hook fires its own (debounced) projection fetches on
// mount; stub it so it doesn't consume the shared fetchMock queue the solve /
// project tests rely on. Its own behavior is covered by net-to-heirs.test.ts.
vi.mock("../use-solver-net-to-heirs", () => ({
  useSolverNetToHeirs: () => ({
    netToHeirs: null,
    netToHeirsDelta: null,
    firstDeathYear: null,
    loading: false,
  }),
}));

vi.mock("@/components/charts/portfolio-bars-chart", () => ({
  PortfolioBarsChart: ({ current }: { current: Array<{ portfolioAssets: { total: number } }> }) => (
    <div data-testid="chart-current-total">
      {current.at(-1)?.portfolioAssets.total ?? "none"}
    </div>
  ),
  // The real helper sums the liquid sub-totals; these fixtures only carry
  // `total`, so stub it to read that. The workspace tests exercise wiring,
  // not the liquid-vs-total arithmetic (covered by the chart's own tests).
  liquidPortfolioTotal: (y: { portfolioAssets: { total: number } }) =>
    y.portfolioAssets.total,
}));

// Stubbed like PortfolioBarsChart: the report-layout tests switch the active
// report to Cash Flow, whose chart + year-detail panel read income/expense
// fields these minimal fixtures don't carry. Wiring, not the cash-flow report
// content, is under test here (each has its own dedicated tests).
vi.mock("@/components/charts/solver-cash-flow-chart", () => ({
  SolverCashFlowChart: () => <div data-testid="chart-cashflow" />,
}));
vi.mock("../solver-year-detail-panel", () => ({
  SolverYearDetailPanel: () => <div data-testid="year-detail" />,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  // Clear the working-state draft so a mutation persisted by one test can't be
  // restored into the next (the workspace now autosaves mutations to localStorage).
  localStorage.clear();
  fetchMock.mockReset();
  routerPush.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mcCalls.length = 0;
  mcStateRef.current = {
    status: "idle",
    baseSuccessRate: null,
    workingSuccessRate: null,
  };
  showToastMock.mockReset();
  saveReportLayoutMock.mockReset();
  saveReportLayoutMock.mockResolvedValue({ ok: true });
});

const baseProps = {
  clientId: "client-id",
  userId: "user-id",
  baseClientData: {
    client: {
      firstName: "Cooper",
      lastName: "Smith",
      dateOfBirth: "1965-03-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      filingStatus: "single",
    },
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {},
  } as never,
  baseProjection: [{ year: 2026, portfolioAssets: { total: 1_000_000 } }] as never,
  initialSource: "base" as const,
  initialSourceClientData: {
    client: {
      firstName: "Cooper",
      lastName: "Smith",
      dateOfBirth: "1965-03-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      filingStatus: "single",
    },
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {},
  } as never,
  initialSourceProjection: [{ year: 2026, portfolioAssets: { total: 1_000_000 } }] as never,
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
    scenarioRef: "base",
  },
  clientName: "Client",
  spouseName: "Spouse",
  categoryGrowthDefaults: { taxable: 0.06, retirement: 0.06, cash: 0.02 },
  retirementDefaultMix: [],
  baseGifts: [],
  initialReportLayout: resolveReportLayout(null),
};

function makeSseStream(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Cooper's Retirement Age is now a slider (Radix). Each arrow press commits one
 * step — mirroring the old per-keystroke input mutation. Default base is 65.
 */
function setCooperRetirementAge(target: number, from = 65) {
  const slider = screen.getByRole("slider", { name: /Cooper's Retirement Age/i });
  slider.focus();
  const key = target >= from ? "ArrowRight" : "ArrowLeft";
  for (let i = 0; i < Math.abs(target - from); i++) {
    fireEvent.keyDown(slider, { key });
  }
  return slider;
}

describe("<LiveSolverWorkspace />", () => {
  it("renders the Solver page with Base Facts column label", () => {
    render(<LiveSolverWorkspace {...baseProps} />);
    const baseFactsLabels = screen.getAllByText(/Base Facts/i);
    expect(baseFactsLabels.length).toBeGreaterThan(0);
  });

  it("debounces input changes into a single POST", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }] }),
    });
    render(<LiveSolverWorkspace {...baseProps} />);

    // Three slider steps (65→68) each commit a mutation; the debounce coalesces
    // them into a single POST carrying the final value.
    setCooperRetirementAge(68);

    // debounce is 600 ms — allow 1.5 s to avoid flakiness
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
    const lastCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.mutations).toEqual([
      { kind: "retirement-age", person: "client", age: 68 },
    ]);
  });
});

describe("LiveSolverWorkspace — Life Insurance solve gating", () => {
  // Count only straight-line LI solves. `/life-insurance/solve-mc` also contains
  // "/life-insurance/solve", so match the exact route suffix to exclude it.
  const countLiSolves = () =>
    fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).endsWith("/life-insurance/solve"),
    ).length;

  const liResult = {
    isMarried: false,
    client: {
      status: "solved",
      faceValue: 500_000,
      achievedEndingPortfolio: 0,
      projection: [],
      existingPolicies: [],
      existingCoverageTotal: 0,
      estateTaxAddend: 0,
    },
    spouse: null,
  };

  it("stays silent while LI is inactive, solves once on enable, and debounces an edit", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => liResult });

    render(<LiveSolverWorkspace {...baseProps} />);

    // Default view is Retirement — the LI hook is disabled, so no LI solve has
    // fired even though the workspace mounted and auto-ran MC.
    expect(countLiSolves()).toBe(0);

    // Switching to the Life Insurance INPUT tab enables the hook → exactly one
    // solve fires on the false→true edge. Anchor the name to the input tab
    // ("Life Insurance") so it doesn't also match the report tab ("Life
    // Insurance Need").
    fireEvent.click(screen.getByRole("tab", { name: /^Life Insurance$/ }));
    await waitFor(() => expect(countLiSolves()).toBe(1));

    // Editing an assumption debounces a single additional solve (not one per
    // keystroke; here a single commit, asserted after the 600ms debounce).
    const deathYear = screen.getByLabelText("Death year");
    fireEvent.change(deathYear, { target: { value: "2031" } });
    await waitFor(() => expect(countLiSolves()).toBe(2), { timeout: 1500 });
  });
});

describe("LiveSolverWorkspace — solve lifecycle", () => {
  it("starts a solve and applies the solved value as a mutation on result", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        makeSseStream([
          { event: "progress", data: { iteration: 1, candidateValue: 50, achievedPoS: 0.7 } },
          { event: "progress", data: { iteration: 2, candidateValue: 80, achievedPoS: 0.95 } },
          {
            event: "result",
            data: {
              status: "converged",
              solvedValue: 67,
              achievedPoS: 0.85,
              canonicalPoS: 0.83,
              iterations: 4,
              finalProjection: [{ year: 2026, portfolioAssets: { total: 1_200_000 } }],
            },
          },
        ]),
      ),
    );

    render(<LiveSolverWorkspace {...baseProps} />);

    const solveIcon = await screen.findByLabelText(/Solve .* Retirement Age/i);
    fireEvent.click(solveIcon);

    // The popover renders a "Solve" button (role=button name=Solve). The Solve icon
    // also has an aria-label containing "Solve". To avoid matching the icon, query
    // for the button whose accessible name is EXACTLY "Solve".
    const submit = await screen.findByRole("button", { name: /^Solve$/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });

    // After the solve completes the retirement-age mutation (67) is applied to
    // workingTree, which re-renders the (controlled) slider at 67 — exposed via
    // the thumb's aria-valuenow.
    const sliderAfter = screen.getByRole("slider", { name: /Cooper's Retirement Age/i });
    expect(sliderAfter).toHaveAttribute("aria-valuenow", "67");
  });
});

describe("LiveSolverWorkspace — save scenario", () => {
  it("refreshes the router after a successful save so the scenario chip row updates", async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (typeof url === "string" && url.includes("/save-scenario")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ scenarioId: "new-scenario-id" }),
        });
      }
      // debounced /project recompute
      return Promise.resolve({
        ok: true,
        json: async () => ({
          projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }],
        }),
      });
    });

    render(<LiveSolverWorkspace {...baseProps} />);

    // A mutation is required before the "Save as scenario…" button enables.
    setCooperRetirementAge(67);

    const openSave = screen.getByRole("button", { name: /Save as scenario/i });
    await waitFor(() => expect(openSave).not.toBeDisabled());
    fireEvent.click(openSave);

    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Retire at 67" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save scenario$/ }));

    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    // Stay on the solver page after saving — no navigation to the cash-flow report.
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe("LiveSolverWorkspace — save to base facts", () => {
  it("POSTs mutations+source to save-to-base and refreshes the router on success", async () => {
    vi.stubGlobal("confirm", () => true);

    fetchMock.mockImplementation((url: unknown) => {
      if (typeof url === "string" && url.includes("/save-to-base")) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      // debounced /project recompute
      return Promise.resolve({
        ok: true,
        json: async () => ({
          projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }],
        }),
      });
    });

    render(<LiveSolverWorkspace {...baseProps} />);

    // Seed a base-saveable mutation via the quick-add account form. Only
    // account / savings-rule upserts can be persisted to base facts, so the
    // button stays disabled for lever-only edits (e.g. a retirement-age change).
    fireEvent.click(screen.getAllByRole("button", { name: /add account/i })[0]);
    fireEvent.change(screen.getAllByLabelText(/annual savings/i)[0], {
      target: { value: "12000" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]);

    const saveToBaseBtn = screen.getAllByRole("button", { name: /Save to base facts/i })[0];
    await waitFor(() => expect(saveToBaseBtn).not.toBeDisabled());
    fireEvent.click(saveToBaseBtn);

    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));

    const saveToBaseCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/save-to-base"),
    );
    expect(saveToBaseCall).toBeDefined();
    const body = JSON.parse(saveToBaseCall![1].body as string);
    expect(body.source).toBe("base");
    const kinds = body.mutations.map((m: { kind: string }) => m.kind);
    expect(kinds).toContain("account-upsert");
    expect(kinds).toContain("savings-rule-upsert");
  });
});

describe("LiveSolverWorkspace — editing-surface tabs", () => {
  it("switches between the Retirement and Techniques tabs", () => {
    render(<LiveSolverWorkspace {...baseProps} />);
    // Retirement tab is active by default — its Goals section is visible.
    expect(screen.getByText("Goals")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /techniques/i }));
    // Techniques tab shows the technique groups.
    expect(screen.getByText("Roth Conversions")).toBeTruthy();
  });
});

describe("LiveSolverWorkspace — right-column source change", () => {
  it("renders the new source's projection when the workspace is remounted by source key", () => {
    // page.tsx keys the workspace on `source`; switching the right-column
    // scenario remounts it so currentProjection re-initializes from the new
    // initialSourceProjection instead of keeping the previous source's data.
    const { rerender } = render(<LiveSolverWorkspace key="base" {...baseProps} />);
    expect(screen.getByTestId("chart-current-total")).toHaveTextContent("1000000");

    rerender(
      <LiveSolverWorkspace
        key="scenario-x"
        {...baseProps}
        initialSource="scenario-x"
        initialSourceProjection={
          [{ year: 2026, portfolioAssets: { total: 2_500_000 } }] as never
        }
      />,
    );
    expect(screen.getByTestId("chart-current-total")).toHaveTextContent("2500000");
  });
});

describe("LiveSolverWorkspace — Monte Carlo auto-run", () => {
  it("auto-runs MC including Base on first mount", async () => {
    render(<LiveSolverWorkspace {...baseProps} />);
    // The first/auto run is enabled and includes the Base column.
    await waitFor(() => {
      expect(mcCalls.some((c) => c.enabled && c.includeBase)).toBe(true);
    });
  });

  it("auto-runs the working plan only after an edit, with no Recalculate click", async () => {
    // Hook reports a ready result so the Scenario gauge starts fresh.
    mcStateRef.current = {
      status: "ready",
      baseSuccessRate: 0.8,
      workingSuccessRate: 0.85,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }],
      }),
    });

    render(<LiveSolverWorkspace {...baseProps} />);
    // Real timers: this test waits out the 2s debounce plus a margin past the
    // ~4s mark where a degraded relaunch would land — extend past the default
    // 5s test timeout so that wait isn't itself the failure.

    // The mount auto-run includes Base; a working-only run is the signal that
    // the edit-driven auto-run fired.
    const workingOnlyRan = () =>
      mcCalls.some((c) => c.enabled && c.includeBase === false);
    // Distinct nonces among working-only calls == distinct working-only
    // launches (see the mock's comment above) — this is what actually pins
    // the trailing-debounce invariant; `workingOnlyRan()` alone can't tell one
    // launch from two.
    const workingOnlyNonces = () =>
      new Set(
        mcCalls.filter((c) => c.enabled && c.includeBase === false).map((c) => c.nonce),
      );
    expect(workingOnlyRan()).toBe(false);

    // Two keyDowns (65→67) land as one burst — a single stale streak, not two.
    setCooperRetirementAge(67);

    // The debounce is real: nothing launches on the edit itself.
    expect(workingOnlyRan()).toBe(false);
    // And no button is offered — the gauge re-runs on its own.
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();

    // AUTO_RUN_DEBOUNCE_MS is 2s; allow 4s to avoid flakiness (real timers).
    await waitFor(() => expect(workingOnlyRan()).toBe(true), { timeout: 4000 });
    // Keep waiting past the ~4s mark where a degraded (leading, not trailing)
    // debounce would fire a second working-only run off the first edit of the
    // burst instead of the last — see the LOAD-BEARING comment on the auto-run
    // effect in live-solver-workspace.tsx.
    await new Promise((r) => setTimeout(r, 2500));
    expect(workingOnlyNonces().size).toBe(1);
  }, 10_000);

  it("cached Base % survives the edit-driven auto-run", async () => {
    // Seed a ready result so the component's cached-base effect fires on mount
    // and sets cachedBaseSuccess=0.8. The two-pane design shows the base value
    // as a sub-hint beneath the scenario gauge: "↑ from 80%".
    mcStateRef.current = {
      status: "ready",
      baseSuccessRate: 0.8,
      workingSuccessRate: 0.85,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }],
      }),
    });

    render(<LiveSolverWorkspace {...baseProps} />);
    expect(screen.getByText(/from 80%/)).toBeTruthy();

    setCooperRetirementAge(67);

    // After the working-only auto-run the cached base sub-hint must still be
    // present — cachedBaseSuccess was set on the first ready run and must not
    // be cleared.
    await waitFor(
      () => expect(mcCalls.some((c) => c.enabled && c.includeBase === false)).toBe(true),
      { timeout: 4000 },
    );
    expect(screen.getByText(/from 80%/)).toBeTruthy();
  });

  it("auto-run failure is recoverable: Recalculate re-includes Base while uncached", async () => {
    // Simulate a failed auto-run: hook starts in error state, so cachedBaseSuccess
    // is never set. The Scenario gauge is in error → overlay shows immediately.
    mcStateRef.current = {
      status: "error",
      baseSuccessRate: null,
      workingSuccessRate: null,
    };

    render(<LiveSolverWorkspace {...baseProps} />);

    // Recalculate overlay appears on error state (no edit needed).
    const recalc = await screen.findByRole("button", { name: /recalculate/i });

    const callsBefore = mcCalls.length;
    fireEvent.click(recalc);

    // With the fix: cachedBaseSuccess===null → launchMc(true) → includeBase true.
    // Without the fix: launchMc(false) always → includeBase false → assertion fails.
    await waitFor(() => {
      const launched = mcCalls.slice(callsBefore).find((c) => c.enabled);
      expect(launched?.includeBase).toBe(true);
    });
  });

  it("does not auto-run while a solve is in flight (the solveActive guard)", async () => {
    // Seed a ready result — like the burst test above — so the mount auto-run
    // sets mcEditNonce and the gauge can actually reach "stale" once we edit.
    // Without this, mc.status stays the beforeEach default "idle" forever and
    // shouldAutoRunMc is false for an unrelated reason, which is exactly the
    // blind spot that let the pre-fix solve test pass with the guard deleted.
    mcStateRef.current = {
      status: "ready",
      baseSuccessRate: 0.8,
      workingSuccessRate: 0.85,
    };
    // The solve's request never resolves, so the solve stays in flight
    // (activeSolve non-null) for the life of the test: handleSolveStart sets
    // activeSolve synchronously, before the awaited fetch.
    fetchMock.mockImplementation(() => new Promise<never>(() => {}));

    render(<LiveSolverWorkspace {...baseProps} />);

    // Start a retirement-age solve and leave it stalled.
    const solveIcon = await screen.findByLabelText(/Solve .* Retirement Age/i);
    fireEvent.click(solveIcon);
    const submit = await screen.findByRole("button", { name: /^Solve$/ });
    fireEvent.click(submit);
    // The retirement-age row swaps its slider for a progress strip
    // (role="status") while the solve owns that lever — confirms the solve is
    // genuinely in flight rather than having errored out synchronously.
    await screen.findByRole("status");

    // Edit a DIFFERENT lever — Life Expectancy isn't disabled by a
    // retirement-age solve — so the gauge has a real reason to go "stale".
    // (Cooper's Retirement Age itself is unusable here: mid-solve its slider
    // is replaced by the progress strip above.)
    const leSlider = screen.getByRole("slider", { name: /Cooper's Life Expectancy/i });
    leSlider.focus();
    fireEvent.keyDown(leSlider, { key: "ArrowRight" });

    const workingOnlyRan = () =>
      mcCalls.some((c) => c.enabled && c.includeBase === false);

    // Real timers, well past AUTO_RUN_DEBOUNCE_MS (2s): the guard must hold
    // for the solve's whole lifetime, not just the debounce window.
    await new Promise((r) => setTimeout(r, 3000));
    expect(workingOnlyRan()).toBe(false);
  }, 10_000);

  it("does not auto-run while a run is already in flight (the single-in-flight guard)", async () => {
    // Seed "ready" first — like the solveActive-guard test above — so the
    // mount auto-run caches Base success (cachedBaseSuccess=0.8). That
    // caching is what makes a stray launch detectable below: once cached, any
    // further auto-run is working-only (includeBase:false), which is exactly
    // what a real in-flight-then-edit sequence would produce, and exactly
    // what the workingOnlyRan() check is watching for.
    mcStateRef.current = {
      status: "ready",
      baseSuccessRate: 0.8,
      workingSuccessRate: 0.85,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        projection: [{ year: 2026, portfolioAssets: { total: 900_000 } }],
      }),
    });

    render(<LiveSolverWorkspace {...baseProps} />);

    // Now put the hook into "loading" — mcStateRef is read fresh on every
    // render, so this takes effect on the next render, which the edit below
    // triggers. deriveScenarioGaugeState's first branch forces "computing"
    // whenever mcStatus is "loading", regardless of editNonce bookkeeping —
    // this is the single-in-flight guard's own state, distinct from the
    // solveActive guard exercised above.
    mcStateRef.current = { ...mcStateRef.current, status: "loading" };

    // Edit a lever while the (mocked) run is in flight.
    setCooperRetirementAge(67);

    const workingOnlyRan = () =>
      mcCalls.some((c) => c.enabled && c.includeBase === false);

    // Real timers, well past AUTO_RUN_DEBOUNCE_MS (2s): a run already in
    // flight must not trigger another.
    await new Promise((r) => setTimeout(r, 3000));
    expect(workingOnlyRan()).toBe(false);
  }, 10_000);
});

describe("LiveSolverWorkspace — report vs input tab independence", () => {
  it("leaves the active report alone when the input tab changes", async () => {
    // The Life Insurance input tab enables the LI solve hook, which fetches.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        isMarried: false,
        client: {
          status: "solved",
          faceValue: 500_000,
          achievedEndingPortfolio: 0,
          projection: [],
          existingPolicies: [],
          existingCoverageTotal: 0,
          estateTaxAddend: 0,
        },
        spouse: null,
      }),
    });
    render(<LiveSolverWorkspace {...baseProps} />);

    // The advisor picks a report themselves.
    fireEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(screen.getByRole("tab", { name: "Cash Flow" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Switching input tabs used to force that tab's default report on the right
    // pane (Life Insurance → "Life Insurance Need"), blowing away the advisor's
    // choice. Anchor the name to the input tab so it doesn't match the report tab.
    fireEvent.click(screen.getByRole("tab", { name: /^Life Insurance$/ }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^Life Insurance$/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("tab", { name: "Cash Flow" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("LiveSolverWorkspace — report layout customization", () => {
  // Portfolio is the report the workspace lands on. The report tabs and the
  // popover switches share accessible names, so queries disambiguate by role
  // ("tab" vs "switch").

  it("rolls back the layout + active report and toasts when the save fails", async () => {
    saveReportLayoutMock.mockResolvedValue({ ok: false });
    render(<LiveSolverWorkspace {...baseProps} />);

    expect(screen.getByRole("tab", { name: "Portfolio" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Hide the active report (Portfolio) via the customize popover.
    fireEvent.click(screen.getByRole("button", { name: /customize reports/i }));
    fireEvent.click(screen.getByRole("switch", { name: "Portfolio" }));

    // Optimistically Portfolio's tab is gone (active jumps to the next visible).
    expect(screen.queryByRole("tab", { name: "Portfolio" })).toBeNull();

    // The save fails → roll back: Portfolio returns AND is active again, + toast.
    await waitFor(() => expect(showToastMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("tab", { name: "Portfolio" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches the active report to the first visible when the active is hidden", async () => {
    render(<LiveSolverWorkspace {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /customize reports/i }));
    fireEvent.click(screen.getByRole("switch", { name: "Portfolio" }));

    // Portfolio (active) hidden → Cash Flow becomes active; the save succeeds so
    // the switch sticks and no failure toast fires.
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Portfolio" })).toBeNull();
      expect(screen.getByRole("tab", { name: "Cash Flow" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it("coalesces rapid saves single-flight so the latest layout wins", async () => {
    // First save hangs until we resolve it; the second edit must queue, not fire
    // a concurrent, potentially out-of-order upsert.
    let resolveFirst: (v: { ok: boolean }) => void = () => {};
    saveReportLayoutMock.mockImplementationOnce(
      () => new Promise<{ ok: boolean }>((r) => (resolveFirst = r)),
    );
    saveReportLayoutMock.mockResolvedValue({ ok: true });

    render(<LiveSolverWorkspace {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /customize reports/i }));

    // Two rapid hides of non-active reports (active stays Portfolio throughout).
    fireEvent.click(screen.getByRole("switch", { name: "Estate" }));
    fireEvent.click(screen.getByRole("switch", { name: "Education" }));

    // Single-flight: only the first save is in flight; the second is queued.
    expect(saveReportLayoutMock).toHaveBeenCalledTimes(1);

    // Resolve the first → the queued (latest) layout flushes.
    await act(async () => {
      resolveFirst({ ok: true });
    });
    await waitFor(() => expect(saveReportLayoutMock).toHaveBeenCalledTimes(2));

    // The last write carries BOTH hides — the coalesced latest state.
    const lastArg = saveReportLayoutMock.mock.calls.at(-1)![0] as Array<{
      id: string;
      visible: boolean;
    }>;
    expect(lastArg.find((e) => e.id === "estate")!.visible).toBe(false);
    expect(lastArg.find((e) => e.id === "education")!.visible).toBe(false);
  });
});
