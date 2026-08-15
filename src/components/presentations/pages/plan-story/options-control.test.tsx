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
import { CHAPTER_IDS } from "@/lib/presentations/story/types";
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
    // `objectContaining`, like the sibling assertion below: a preset carries a
    // document role and a chapter set and says nothing about the rest of the
    // options, so an exact whole-object match here is a match on fields this
    // test is not about — and every field added to `PlanStoryOptions` since has
    // broken it.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "brief",
        documentRole: "frontMatter",
        scenarioId: LIVE_ID,
        sections: PRESETS.brief.sections,
      }),
    );
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

  /**
   * The report-level pair.
   *
   * ⚠️ A BULK SETTER, not a stored default. `PlanStoryOptions` has one style
   * field — `chapterStyle`, per chapter — and no `defaultStyle`, so there is
   * nothing for a per-chapter value to override. This control writes all
   * fourteen entries and displays what they say.
   */
  describe("the report-level voice", () => {
    const MIXED: PlanStoryOptions["chapterStyle"] = {
      ...PLAN_STORY_OPTIONS_DEFAULT.chapterStyle,
      planInOnePage: { tone: "direct", length: "short" },
    };

    function styles(onChange: ReturnType<typeof vi.fn>) {
      return (onChange.mock.calls[0][0] as PlanStoryOptions).chapterStyle;
    }

    it("writes the picked tone to every chapter, not just one", () => {
      const { onChange } = renderControl();
      fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "direct" } });
      const next = styles(onChange);
      expect(CHAPTER_IDS.every((id) => next[id].tone === "direct")).toBe(true);
    });

    // Kills: rebuilding the entry from the default instead of from what is
    // stored. Setting the tone would then silently reset fourteen lengths.
    it("keeps each chapter's length when only the tone moves", () => {
      const { onChange } = renderControl({ chapterStyle: MIXED });
      fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "plain" } });
      const next = styles(onChange);
      expect(next.planInOnePage).toEqual({ tone: "plain", length: "short" });
      expect(next.thingsToKnow).toEqual({ tone: "plain", length: "standard" });
    });

    it("writes the picked length to every chapter, keeping their tones", () => {
      const { onChange } = renderControl({ chapterStyle: MIXED });
      fireEvent.change(screen.getByLabelText("Length"), { target: { value: "full" } });
      const next = styles(onChange);
      expect(CHAPTER_IDS.every((id) => next[id].length === "full")).toBe(true);
      expect(next.planInOnePage.tone).toBe("direct");
    });

    it("shows the shared value when all fourteen agree", () => {
      renderControl();
      expect((screen.getByLabelText("Tone") as HTMLSelectElement).value).toBe("warm");
      expect((screen.getByLabelText("Length") as HTMLSelectElement).value).toBe("standard");
    });

    /**
     * ⭐ Without this the control shows one chapter's value as though it were
     * the report's, and quietly contradicts the per-chapter selects below it.
     */
    it("reads Mixed rather than picking a side when they disagree", () => {
      renderControl({ chapterStyle: MIXED });
      const tone = screen.getByLabelText("Tone") as HTMLSelectElement;
      expect(tone.value).toBe("");
      expect(tone.selectedOptions[0].textContent).toBe("Mixed");
      // Something the chapters ARE, not something to pick.
      expect(tone.selectedOptions[0].disabled).toBe(true);
    });

    it("does not offer Mixed once the fourteen agree", () => {
      renderControl();
      const labels = Array.from(
        (screen.getByLabelText("Tone") as HTMLSelectElement).options,
      ).map((o) => o.textContent);
      expect(labels).toEqual(["Warm", "Plain", "Direct"]);
    });

    // Kills: copying the chapter checkboxes' `preset: "custom"`. A preset names
    // a document role and a chapter set and says nothing about the voice, so a
    // Full story read in a direct register is still a Full story.
    it("leaves the report in its preset", () => {
      const { onChange } = renderControl();
      fireEvent.change(screen.getByLabelText("Length"), { target: { value: "short" } });
      expect((onChange.mock.calls[0][0] as PlanStoryOptions).preset).toBe("full");
    });

    it("hands the panel the stored style rather than a fresh default", async () => {
      renderControl({ chapterStyle: MIXED, scenarioId: LIVE_ID });
      await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
      const stale = fetchMock().mock.calls.find((c: unknown[]) =>
        String(c[0]).includes("/plan-story/stale"),
      );
      expect(stale).toBeTruthy();
      expect(String(stale![0])).toContain("planInOnePage%3Adirect%3Ashort");
    });
  });

  it("renders no review panel and fetches nothing without a client in context", async () => {
    renderControl({}, { clientId: null });
    expect(screen.getByText("Preset")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate all/i })).toBeNull();
    // `render` flushes effects, so the panel's load would already have fired.
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
