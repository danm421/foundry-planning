// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import { PLAN_TOKENS } from "@/lib/plan-text/tokens";
import { ObservationsAuthoringPanel } from "../authoring-panel";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SCENARIO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SCENARIO_ID = "33333333-3333-4333-8333-333333333333";
// The scenario a RUN was produced from. Deliberately never the picker's value,
// so a row stamped from the context row instead of the run is visible.
const RUN_SCENARIO_ID = "44444444-4444-4444-8444-444444444444";
const BASE = `/api/clients/${CLIENT_ID}/observations`;

const ALL_RESOLVED = Object.fromEntries(PLAN_TOKENS.map((t) => [t.id, "x"]));

const ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  section: "observation", topic: "retirement", title: null,
  body: "On track to retire at {{client_retirement_age}}.",
  status: "open", owner: null, priority: null, targetDate: null,
  source: "manual", sortOrder: 0, audience: "client", sourceScenarioId: null,
};

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

/** A fetch mock keyed by (method, url). Unmatched calls answer 200 {}. Every
 *  call is recorded on `calls` so tests assert bodies, not just counts. */
function installFetch(handler: Handler) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const res = handler(url, init) ?? { status: 200, body: {} };
    return { ok: res.status < 400, status: res.status, json: async () => res.body } as Response;
  }));
  return calls;
}

function defaults(over: { tokenValues?: Record<string, string | null> | null; context?: Record<string, unknown>; rows?: unknown[] } = {}): Handler {
  return (url, init) => {
    const method = init?.method ?? "GET";
    if (url.endsWith("/token-values")) {
      return over.tokenValues === null ? { status: 500, body: {} } : { status: 200, body: { values: over.tokenValues ?? ALL_RESOLVED } };
    }
    if (url.endsWith("/context") && method === "GET") {
      return { status: 200, body: { observationsContext: "", nextStepsContext: "", nextStepsScenarioId: null, ...over.context } };
    }
    if (url.startsWith(`${BASE}?audience=client`) && method === "GET") return { status: 200, body: over.rows ?? [ROW] };
    if (url === BASE && method === "POST") return { status: 201, body: { ...ROW, id: "new" } };
    if (url.endsWith("/context") && method === "PATCH") return { status: 200, body: { observationsContext: "", nextStepsContext: "", nextStepsScenarioId: SCENARIO_ID, ...init && JSON.parse(String(init.body)) } };
    return undefined;
  };
}

function renderPanel(props: Partial<{ showObservations: boolean; showNextSteps: boolean }> = {}) {
  return render(
    <PresentationOptionsProvider
      value={{
        investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG,
        scenarios: [{ id: SCENARIO_ID, name: "Retire at 62", isBaseCase: false }],
        clientId: CLIENT_ID,
      }}
    >
      <ObservationsAuthoringPanel clientId={CLIENT_ID} showObservations showNextSteps {...props} />
    </PresentationOptionsProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ObservationsAuthoringPanel — observations", () => {
  it("renders the saved rows with tokens resolved", async () => {
    installFetch(defaults({ tokenValues: { ...ALL_RESOLVED, client_retirement_age: "65" } }));
    renderPanel();
    expect(await screen.findByText("On track to retire at 65.")).toBeInTheDocument();
  });

  // "Effective tax rate", not a `topic: "general"` entry: general is also the
  // schema default, so a panel that hardcoded the topic would stay green on
  // one — and this is the only test of the insert path.
  it("Insert a fact posts the entry's token body with its topic, on the client audience", async () => {
    const calls = installFetch(defaults());
    renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.click(screen.getByRole("button", { name: /insert a fact/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Effective tax rate/ }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url === BASE);
      expect(post?.body).toEqual({
        section: "observation",
        source: "manual",
        audience: "client",
        topic: "tax",
        body: "Roughly {{effective_tax_rate}} of your income will go to taxes this year.",
      });
    });
  });

  it("hides a fact whose token does not resolve, and shows every fact while values are unavailable", async () => {
    installFetch(defaults({ tokenValues: { ...ALL_RESOLVED, spouse_first_name: null, spouse_retirement_age: null } }));
    const { unmount } = renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.click(screen.getByRole("button", { name: /insert a fact/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText(/Spouse retirement timing/)).toBeNull();
    expect(within(menu).getByText(/^Retirement timing/)).toBeInTheDocument();
    unmount();

    installFetch(defaults({ tokenValues: null }));
    renderPanel();
    await screen.findByText("On track to retire at ….");
    await userEvent.click(screen.getByRole("button", { name: /insert a fact/i }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem")).toHaveLength(11);
  });

  it("saves the observations note on blur and keeps the text when the save fails", async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith("/context") && init?.method === "PATCH") return { status: 500, body: {} };
      return defaults()(url, init);
    });
    renderPanel();
    await screen.findByText("On track to retire at x.");
    const note = screen.getByPlaceholderText(/anything the draft should know/i);
    await userEvent.type(note, "They asked about college.");
    await userEvent.tab();
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH" && c.url.endsWith("/context"))?.body).toEqual({
        observationsContext: "They asked about college.",
      });
    });
    expect(await screen.findByText(/couldn't save your note/i)).toBeInTheDocument();
    expect(note).toHaveValue("They asked about college.");
  });

  it("shows an error when the note can't be loaded, and never overwrites the stored note", async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith("/context") && (init?.method ?? "GET") === "GET") return { status: 500, body: {} };
      return defaults()(url, init);
    });
    renderPanel();
    // Awaited first so the failed context load has certainly settled before
    // the blur below — otherwise a still-loading `context` would pass the
    // zero-PATCH assertion for the wrong reason.
    expect(await screen.findByText(/couldn't load this client's notes/i)).toBeInTheDocument();

    const note = screen.getByPlaceholderText(/anything the draft should know/i);
    await userEvent.type(note, "They asked about college.");
    await userEvent.tab();
    // THE load-bearing assertion. If the failed load synthesised
    // `{ observationsContext: "" }`, the blur guard compares the typed text
    // against that "", PATCHes, and silently replaces a note the advisor was
    // never shown. Zero PATCHes is the only proof it didn't.
    expect(calls.filter((c) => c.method === "PATCH" && c.url.endsWith("/context"))).toHaveLength(0);
    expect(note).toHaveValue("They asked about college.");
  });

  // The reorder route only scopes its completeness check to the client
  // audience when the body says so. Drop `audience: "client"` and a household
  // that also holds advisor-only rows makes this PUT a silent "Stale order".
  it("reordering an observation sends the swapped order scoped to the client audience", async () => {
    const calls = installFetch(defaults({
      rows: [
        { ...ROW, id: "o1", body: "First." },
        { ...ROW, id: "o2", body: "Second.", sortOrder: 1 },
      ],
    }));
    renderPanel();
    await screen.findByText("First.");
    await userEvent.click(screen.getByRole("button", { name: /move down/i }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/reorder"))?.body).toEqual({
        section: "observation",
        audience: "client",
        orderedIds: ["o2", "o1"],
      });
    });
  });

  it("shows nothing for a section the page will not print", async () => {
    installFetch(defaults());
    renderPanel({ showObservations: false });
    await waitFor(() => expect(screen.queryByRole("button", { name: /insert a fact/i })).toBeNull());
    expect(screen.getByRole("button", { name: /generate from scenario/i })).toBeInTheDocument();
  });
});

describe("ObservationsAuthoringPanel — Draft with AI", () => {
  it("starts an observation run, shows the cards, and Accept all posts one client row per card", async () => {
    const calls = installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/draft-runs") && method === "POST") return { status: 202, body: { runId: "run-1" } };
      if (url.endsWith("/draft-runs/run-1")) {
        return {
          status: 200,
          body: {
            // The RUN's scenario. The picker/context below deliberately holds a
            // DIFFERENT one, so an accepted row stamped from the wrong source is
            // visible rather than coincidentally equal.
            status: "done", error: null, scenarioId: SCENARIO_ID,
            suggestions: [
              { section: "observation", topic: "cash-flow", title: null, body: "You save {{savings_rate}}.", owner: null, priority: null },
              { section: "observation", topic: "tax", title: null, body: "Taxes take {{effective_tax_rate}}.", owner: null, priority: null },
            ],
          },
        };
      }
      return defaults({ context: { nextStepsScenarioId: OTHER_SCENARIO_ID } })(url, init);
    });
    renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.click(screen.getByRole("button", { name: /^draft with ai$/i }));
    expect(calls.find((c) => c.url.endsWith("/draft-runs") && c.method === "POST")?.body).toEqual({ section: "observation" });

    expect(await screen.findByText("You save x.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /accept all/i }));
    await waitFor(() => {
      const posts = calls.filter((c) => c.method === "POST" && c.url === BASE);
      expect(posts).toHaveLength(2);
      // From the RUN, not from the picker: OTHER_SCENARIO_ID would mean the
      // accept path read the context row instead of the run that produced it.
      expect(posts[0].body).toMatchObject({ section: "observation", source: "ai", audience: "client", topic: "cash-flow", sourceScenarioId: SCENARIO_ID });
      expect(posts[1].body).toMatchObject({ topic: "tax" });
    });
    await waitFor(() => expect(screen.queryByText("You save x.")).toBeNull());
  });

  // fireEvent, not userEvent: userEvent awaits between clicks, by which time
  // the POST has resolved and both `active` and `disabled` have flipped. Two
  // SYNCHRONOUS clicks are the real race — the window while the POST is in
  // flight, where neither guard is closed yet. The route has no dedupe, so a
  // second POST is a second real LLM run.
  it("ignores a second click while the first draft request is still in flight", async () => {
    const calls = installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/draft-runs") && method === "POST") return { status: 202, body: { runId: "run-1" } };
      if (url.endsWith("/draft-runs/run-1")) {
        return {
          status: 200,
          body: {
            status: "done", error: null, scenarioId: null,
            suggestions: [{ section: "observation", topic: "tax", title: null, body: "Taxes take {{effective_tax_rate}}.", owner: null, priority: null }],
          },
        };
      }
      return defaults()(url, init);
    });
    renderPanel();
    await screen.findByText("On track to retire at x.");

    const button = screen.getByRole("button", { name: /^draft with ai$/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByText("Taxes take x.")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/draft-runs") && c.method === "POST")).toHaveLength(1);
  });
});

describe("ObservationsAuthoringPanel — next steps", () => {
  it("picking a source scenario PATCHes the context row", async () => {
    const calls = installFetch(defaults());
    renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.selectOptions(screen.getByLabelText(/source scenario/i), SCENARIO_ID);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH" && c.url.endsWith("/context"))?.body).toEqual({ nextStepsScenarioId: SCENARIO_ID });
    });
  });

  // Both boxes carry the same message, so one shared error state prints a
  // next-steps failure under the OBSERVATIONS box — the advisor is told the
  // note they didn't touch failed to save.
  it("a next-steps note failure shows under the next-steps box, not the observations one", async () => {
    installFetch((url, init) => {
      if (url.endsWith("/context") && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
        if ("nextStepsContext" in patch) return { status: 500, body: {} };
      }
      return defaults()(url, init);
    });
    renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.type(screen.getByPlaceholderText(/what to stress/i), "Push the Roth conversion.");
    await userEvent.tab();

    const shown = await screen.findByText(/couldn't save your note/i);
    expect(screen.getAllByText(/couldn't save your note/i)).toHaveLength(1);
    const section = (name: string) => screen.getByRole("heading", { name }).closest("section")!;
    expect(within(section("Next steps")).getByText(/couldn't save your note/i)).toBe(shown);
    expect(within(section("Observations")).queryByText(/couldn't save your note/i)).toBeNull();
  });

  it("Generate is disabled with a hint until a scenario is picked", async () => {
    installFetch(defaults());
    renderPanel();
    await screen.findByText("On track to retire at x.");
    expect(screen.getByRole("button", { name: /generate from scenario/i })).toBeDisabled();
    expect(screen.getByText(/pick a source scenario first/i)).toBeInTheDocument();
  });

  it("generate → cards → Accept all stamps every row with the RUN's scenario, not the picker's", async () => {
    const calls = installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/draft-runs") && method === "POST") return { status: 202, body: { runId: "run-2" } };
      if (url.endsWith("/draft-runs/run-2")) {
        return {
          status: 200,
          body: {
            status: "done", error: null, scenarioId: RUN_SCENARIO_ID,
            suggestions: [
              { section: "next_step", topic: "retirement", title: "Update the deferral", body: "Raise it to 12%.", owner: "client", priority: "high" },
              { section: "next_step", topic: "tax", title: "Open a Roth", body: "Before 2028.", owner: "advisor", priority: "medium" },
            ],
          },
        };
      }
      return defaults({ context: { nextStepsScenarioId: SCENARIO_ID } })(url, init);
    });
    renderPanel();
    await screen.findByText("On track to retire at x.");
    // Generate stays disabled until the /context GET resolves.
    await waitFor(() => expect(screen.getByRole("button", { name: /generate from scenario/i })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: /generate from scenario/i }));
    expect(calls.find((c) => c.url.endsWith("/draft-runs") && c.method === "POST")?.body).toEqual({ section: "next_step" });
    await screen.findByText("Update the deferral");

    // The advisor changes the picker while the cards are open — the stamp
    // still comes from the run. The picker never held RUN_SCENARIO_ID, so a
    // row stamped from the context row shows up as SCENARIO_ID or null.
    await userEvent.selectOptions(screen.getByLabelText(/source scenario/i), "");
    await userEvent.click(screen.getByRole("button", { name: /accept all/i }));
    await waitFor(() => {
      const posts = calls.filter((c) => c.method === "POST" && c.url === BASE);
      expect(posts).toHaveLength(2);
      for (const p of posts) expect(p.body).toMatchObject({ section: "next_step", source: "ai", audience: "client", sourceScenarioId: RUN_SCENARIO_ID });
    });
  });

  it("prints provenance on AI rows — the live name, or that the scenario is gone", async () => {
    installFetch(defaults({
      rows: [
        { ...ROW, id: "n1", section: "next_step", title: "Update the deferral", body: "b", source: "ai", sourceScenarioId: SCENARIO_ID },
        { ...ROW, id: "n2", section: "next_step", title: "Old step", body: "b", source: "ai", sourceScenarioId: OTHER_SCENARIO_ID },
        { ...ROW, id: "n3", section: "next_step", title: "Hand-typed", body: "b", source: "manual", sourceScenarioId: null },
      ],
    }));
    renderPanel();
    const provenance = await screen.findAllByText(/^From/);
    expect(provenance).toHaveLength(2);
    // Scoped to the row: the picker's <option> carries the same text.
    expect(within(provenance[0]).getByText("Retire at 62")).toBeInTheDocument();
    expect(screen.getByText(/from a scenario that has since been deleted/i)).toBeInTheDocument();
  });

  // Clear calls `stepDraft.clear()`, which nulls `active` and cancels the
  // poll. Mid-run that orphans a paid LLM call and silently flips the Generate
  // button back from "Generating…", so Clear has to be shut while it runs.
  it("Clear AI-generated is disabled while a generate run is in flight", async () => {
    installFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/draft-runs") && method === "POST") return { status: 202, body: { runId: "run-3" } };
      if (url.endsWith("/draft-runs/run-3")) return { status: 200, body: { status: "running", error: null, scenarioId: null, suggestions: null } };
      return defaults({
        context: { nextStepsScenarioId: SCENARIO_ID },
        rows: [{ ...ROW, id: "n1", section: "next_step", title: "AI step", body: "b", source: "ai", sourceScenarioId: SCENARIO_ID }],
      })(url, init);
    });
    renderPanel();
    await screen.findByText("AI step");
    // Enabled first, so the assertion below pins the run — not a button that
    // is simply always disabled.
    expect(screen.getByRole("button", { name: /clear ai-generated/i })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: /generate from scenario/i })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: /generate from scenario/i }));
    await screen.findByRole("button", { name: /generating/i });
    expect(screen.getByRole("button", { name: /clear ai-generated/i })).toBeDisabled();
  });

  it("Clear AI-generated confirms, then DELETEs the scoped query", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = installFetch((url, init) => {
      if (init?.method === "DELETE") return { status: 200, body: { removed: 2 } };
      return defaults({
        rows: [{ ...ROW, id: "n1", section: "next_step", title: "AI step", body: "b", source: "ai", sourceScenarioId: SCENARIO_ID }],
      })(url, init);
    });
    renderPanel();
    await screen.findByText("AI step");
    await userEvent.click(screen.getByRole("button", { name: /clear ai-generated/i }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "DELETE")?.url).toBe(`${BASE}?section=next_step&source=ai`);
    });
  });
});
