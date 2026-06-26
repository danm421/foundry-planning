// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LiveSolverWorkspace } from "../live-solver-workspace";

const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

// Mock the cached-endpoint MC hook so the workspace's auto-run never hits the
// network in tests. `mcStateRef.current` lets individual tests drive the gauge
// state; `mcCalls` records every invocation's enabled flag + includeBase, which
// (post-refactor) is how a first/auto run — Base + Scenario — is distinguished
// from a working-only Recalculate.
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
  mcCalls: [] as Array<{ enabled: boolean; includeBase: boolean }>,
}));
vi.mock("../use-solver-mc", () => ({
  useSolverMc: (args: { enabled: boolean; includeBase: boolean }) => {
    mcCalls.push({ enabled: args.enabled, includeBase: args.includeBase });
    return mcStateRef.current;
  },
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

const fetchMock = vi.fn();
beforeEach(() => {
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
});

const baseProps = {
  clientId: "client-id",
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
    scenarioRef: "base",
  },
  clientName: "Client",
  spouseName: "Spouse",
  categoryGrowthDefaults: { taxable: 0.06, retirement: 0.06, cash: 0.02 },
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

    const cooper = screen.getByRole("spinbutton", { name: /Cooper's Retirement Age/i });
    fireEvent.change(cooper, { target: { value: "66" } });
    fireEvent.change(cooper, { target: { value: "67" } });
    fireEvent.change(cooper, { target: { value: "68" } });

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
    // workingTree, which re-renders the input with defaultValue=67. In JSDOM
    // uncontrolled inputs expose the solved value via the element's value
    // property — use spinbutton role to distinguish the input from the solve icon.
    const inputAfter = screen.getByRole("spinbutton", { name: /Cooper's Retirement Age/i }) as HTMLInputElement;
    expect(inputAfter.value).toBe("67");
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
    const cooper = screen.getByRole("spinbutton", { name: /Cooper's Retirement Age/i });
    fireEvent.change(cooper, { target: { value: "67" } });

    const openSave = screen.getByRole("button", { name: /Save as scenario/i });
    await waitFor(() => expect(openSave).not.toBeDisabled());
    fireEvent.click(openSave);

    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Retire at 67" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save scenario$/ }));

    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    expect(routerPush).toHaveBeenCalledWith(
      "/clients/client-id/cashflow?scenario=new-scenario-id",
    );
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

  it("shows the Recalculate overlay after an edit and re-runs the working plan only", async () => {
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

    // No overlay while fresh.
    expect(screen.queryByRole("button", { name: /recalculate/i })).toBeNull();

    // Edit an input below → Scenario goes stale → overlay appears.
    const cooper = screen.getByRole("spinbutton", { name: /Cooper's Retirement Age/i });
    fireEvent.change(cooper, { target: { value: "67" } });

    const recalc = await screen.findByRole("button", { name: /recalculate/i });
    const callsBefore = mcCalls.length;
    fireEvent.click(recalc);

    // The Recalculate launch is working-only — Base is already cached, so it
    // refetches the Scenario column without re-including Base.
    await waitFor(() => {
      const launched = mcCalls.slice(callsBefore).find((c) => c.enabled);
      expect(launched?.includeBase).toBe(false);
    });
  });

  it("cached Base % survives a working-only Recalculate", async () => {
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

    // The scenario gauge shows "85%" as the main value. The base value (80%)
    // is rendered as a sub-hint "↑ from 80%" below it (since 85 > 80).
    expect(screen.getByText(/from 80%/)).toBeTruthy();

    // Edit an input → Scenario goes stale → Recalculate overlay appears.
    const cooper = screen.getByRole("spinbutton", { name: /Cooper's Retirement Age/i });
    fireEvent.change(cooper, { target: { value: "67" } });

    const recalc = await screen.findByRole("button", { name: /recalculate/i });
    fireEvent.click(recalc);

    // After a working-only Recalculate the cached base sub-hint must still be
    // present — cachedBaseSuccess was set on the first ready run and must not
    // be cleared. The sub-hint "↑ from 80%" remains visible (state is stale,
    // which is one of the conditions for rendering the sub-hint).
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
});
