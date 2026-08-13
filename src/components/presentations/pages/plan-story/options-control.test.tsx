// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanStoryOptionsControl } from "./options-control";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import {
  PLAN_STORY_OPTIONS_DEFAULT,
  PRESETS,
  type PlanStoryOptions,
} from "@/lib/presentations/pages/plan-story/options-schema";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

const LIVE_ID = "11111111-1111-4111-8111-111111111111";

/** What the launcher actually hands the provider: every scenario row this
 *  client owns, base case included and orphaned integration-test rows and all.
 *  The snapshot entry is the shape the deck's own picker produces — a ref that
 *  generation refuses (400) and that the export loader degrades to "there is a
 *  recommendation" with nothing to recommend. */
const SCENARIOS: ScenarioOption[] = [
  { id: LIVE_ID, name: "Retire at 62", isBaseCase: false },
  { id: "22222222-2222-4222-8222-222222222222", name: "Base Case", isBaseCase: true },
  { id: "33333333-3333-4333-8333-333333333333", name: "writer-test-9f2", isBaseCase: false },
  { id: "snap:44444444-4444-4444-8444-444444444444", name: "Q1 snapshot", isBaseCase: false },
];

function renderControl(
  overrides: Partial<PlanStoryOptions> = {},
  opts: { clientId?: string | null; scenarios?: ScenarioOption[] } = {},
) {
  const onChange = vi.fn();
  const value = { ...PLAN_STORY_OPTIONS_DEFAULT, ...overrides };
  const control = <PlanStoryOptionsControl value={value} onChange={onChange} />;
  render(
    opts.clientId === null ? (
      control
    ) : (
      <PresentationOptionsProvider
        value={{
          investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG,
          scenarios: opts.scenarios ?? SCENARIOS,
          clientId: opts.clientId ?? "c1",
        }}
      >
        {control}
      </PresentationOptionsProvider>
    ),
  );
  return { onChange };
}

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ scenarioId: "base", chapters: [] }), { status: 200 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlanStoryOptionsControl", () => {
  it("renders the preset, chapter and proposed-plan groups", () => {
    renderControl();
    expect(screen.getByText("Preset")).toBeInTheDocument();
    expect(screen.getByText("The story")).toBeInTheDocument();
    expect(screen.getByText("Areas you cover")).toBeInTheDocument();
    expect(screen.getByLabelText("Proposed plan")).toBeInTheDocument();
    expect(screen.getByText("What we're recommending, and why")).toBeInTheDocument();
  });

  it("offers one checkbox per chapter of the arc, split by kind", () => {
    renderControl();
    expect(screen.getAllByRole("checkbox")).toHaveLength(14);
    // The four an advisor switches off because someone else handles that area.
    for (const title of [
      "What's left for the people you care about",
      "What you'll pay in tax",
      "Protecting your family",
      "Health care costs in retirement",
    ]) {
      expect(screen.getByRole("checkbox", { name: title })).toBeInTheDocument();
    }
  });

  it("tells the advisor what the Executive brief is good in front of", () => {
    renderControl({ preset: "brief" });
    expect(screen.getByText(/reads as a cliff/i)).toBeInTheDocument();
  });

  it("keeps that caveat off the canvas for every other preset", () => {
    renderControl();
    expect(screen.queryByText(/reads as a cliff/i)).toBeNull();
  });

  it("applies a preset's document role and chapter set, keeping the proposed plan", () => {
    const { onChange } = renderControl({ scenarioId: LIVE_ID });
    fireEvent.click(screen.getByRole("radio", { name: "Executive brief" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "brief",
      documentRole: "frontMatter",
      scenarioId: LIVE_ID,
      sections: PRESETS.brief.sections,
    });
  });

  it("drops the report out of its preset when a chapter is toggled by hand", () => {
    const { onChange } = renderControl();
    fireEvent.click(screen.getByRole("checkbox", { name: "What you have" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "custom",
        sections: { ...PLAN_STORY_OPTIONS_DEFAULT.sections, whatYouHave: false },
      }),
    );
  });

  it("writes the picked scenario to scenarioId", () => {
    const { onChange } = renderControl();
    fireEvent.change(screen.getByLabelText("Proposed plan"), {
      target: { value: LIVE_ID },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: LIVE_ID }),
    );
  });

  it("writes an empty scenarioId for the no-proposed-plan choice", () => {
    const { onChange } = renderControl({ scenarioId: LIVE_ID });
    fireEvent.change(screen.getByLabelText("Proposed plan"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "" }));
  });

  it("offers only live scenarios — no base case, no orphan test rows, no snapshot ref", () => {
    renderControl();
    const values = Array.from(
      (screen.getByLabelText("Proposed plan") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(values).toEqual(["", LIVE_ID]);
  });

  it("mounts the review panel for the client in context, on the picked scenario", async () => {
    renderControl({ scenarioId: LIVE_ID });
    expect(await screen.findByRole("button", { name: /generate all/i })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    expect(String(fetchMock().mock.calls[0][0])).toBe(
      `/api/clients/c1/plan-story?scenarioId=${LIVE_ID}&documentRole=standalone`,
    );
  });

  // Kills: hardcoding the panel's `documentRole`. The preset sets it correctly
  // in options and the export reads it correctly, but this handoff is the only
  // path from either to the MODEL — the panel is the generate route's sole
  // production caller — so a hardcoded value here makes the Executive brief
  // preset inert end to end.
  it("hands the review panel the preset's register rather than a fixed one", async () => {
    renderControl({ scenarioId: LIVE_ID, documentRole: "frontMatter" });
    fireEvent.click(await screen.findByRole("button", { name: /generate all/i }));
    await waitFor(() => {
      const post = fetchMock().mock.calls.find(
        (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(String((post![1] as RequestInit).body)).toContain('"documentRole":"frontMatter"');
    });
  });

  it("names the scenario select with a real label rather than an aria-label", () => {
    renderControl();
    const select = screen.getByLabelText("Proposed plan");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-label")).toBeNull();
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe("Proposed plan");
  });

  it("renders no review panel and fetches nothing without a client in context", async () => {
    renderControl({}, { clientId: null });
    expect(screen.getByText("Preset")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate all/i })).toBeNull();
    // `render` flushes effects, so the panel's load would already have fired.
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
