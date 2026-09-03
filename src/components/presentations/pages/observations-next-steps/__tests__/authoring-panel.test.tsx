// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import { PLAN_TOKENS } from "@/lib/plan-text/tokens";
import { ObservationsAuthoringPanel } from "../authoring-panel";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SCENARIO_ID = "22222222-2222-4222-8222-222222222222";
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

  it("Insert a fact posts the entry's token body with its topic, on the client audience", async () => {
    const calls = installFetch(defaults());
    renderPanel();
    await screen.findByText("On track to retire at x.");
    await userEvent.click(screen.getByRole("button", { name: /insert a fact/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Net worth/ }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url === BASE);
      expect(post?.body).toEqual({
        section: "observation",
        source: "manual",
        audience: "client",
        topic: "general",
        body: "Your net worth today is {{net_worth}}, with {{total_liabilities}} of debt outstanding.",
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

  // Un-todo in Task 13, which adds the "Generate from scenario" button this
  // asserts still renders when the observations section is switched off.
  it.todo("shows nothing for a section the page will not print", async () => {
    installFetch(defaults());
    renderPanel({ showObservations: false });
    await waitFor(() => expect(screen.queryByRole("button", { name: /insert a fact/i })).toBeNull());
    expect(screen.getByRole("button", { name: /generate from scenario/i })).toBeInTheDocument();
  });
});
