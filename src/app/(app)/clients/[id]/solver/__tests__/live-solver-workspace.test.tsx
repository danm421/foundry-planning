// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LiveSolverWorkspace } from "../live-solver-workspace";

const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("@/components/charts/portfolio-bars-chart", () => ({
  PortfolioBarsChart: ({ current }: { current: Array<{ portfolioAssets: { total: number } }> }) => (
    <div data-testid="chart-current-total">
      {current.at(-1)?.portfolioAssets.total ?? "none"}
    </div>
  ),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  routerPush.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
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
      "/clients/client-id/comparison?scenario=new-scenario-id",
    );
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
