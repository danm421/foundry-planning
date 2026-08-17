// Task 16: how `renderPresentationPdf` loads the Plan Story, and the two
// properties that make the deck's page numbering trustworthy.
//
// X7 — the load is keyed on the PAGE BEING IN THE DECK, never on the load
// succeeding, and a failure fails the whole export. `document.tsx` reserves each
// Plan Story page's sheets from `estimatePageCount`, which reads the options
// alone and cannot see whether the story loaded, and the TOC takes its start
// pages from that same estimate. A `try { … } catch { undefined }` around the
// load therefore ships a PDF whose contents page points at the wrong sheet for
// everything after the story — silently. This file is what goes red when
// someone adds that catch.
//
// I2 — one payload PER ENTRY. Two Plan Story pages in one deck is a deck the
// product invites (`brief` is the front-of-deck version of `full`), and the
// second entry's options name a different scenario, role and storage scope.
//
// Sibling of `render-presentation-pdf.branding.test.ts` rather than an addition
// to it: that file's design rests on a cover-only deck leaving every other
// conditional branch unreached, and a Plan Story page reaches one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  planStoryOptionsSchema,
  PLAN_STORY_OPTIONS_DEFAULT,
} from "@/lib/presentations/pages/plan-story/options-schema";
import type { PlanStoryOptions } from "@/lib/presentations/pages/plan-story/options-schema";
import type { ExportPdfBody } from "../render-presentation-pdf";

const dbMocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: dbMocks.select } }));

vi.mock("@/lib/branding/branding", () => ({
  resolveBranding: vi.fn().mockResolvedValue({
    firmName: "Firm Brand",
    primaryColor: "#222222",
    logoDataUrl: null,
  }),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: vi.fn(),
}));
vi.mock("@/lib/presentations/default-logo", () => ({
  foundryDefaultLogoDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,DEFAULT"),
}));

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn(async () => ({
    effectiveTree: { client: { firstName: "Jane", lastName: "Doe" }, reinvestments: [] },
  })),
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn(() => ({ years: [] })),
}));

// The two collaborators under test are stubbed at their module boundary — this
// file is about the WIRING (which entry's options produce which payload, and
// which page of the document receives it). Their own behaviour is covered by
// `story/__tests__/scenario-label.test.ts` and
// `presentations/__tests__/export-plan-story.test.ts`.
const storyMocks = vi.hoisted(() => ({
  loadPlanStoryInput: vi.fn(),
  loadStoryScenarioLabel: vi.fn(),
}));
vi.mock("@/lib/presentations/story/load-for-export", () => ({
  loadPlanStoryInput: storyMocks.loadPlanStoryInput,
}));
vi.mock("@/lib/presentations/story/scenario-label", () => ({
  loadStoryScenarioLabel: storyMocks.loadStoryScenarioLabel,
}));

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

// The REAL `planStoryOptionsSchema`, so the descriptor union this module builds
// at import time is the one production builds.
vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    cover: { id: "cover", supportsScenarioOverride: false, optionsSchema: z.object({}) },
    planStory: {
      id: "planStory",
      supportsScenarioOverride: true,
      optionsSchema: planStoryOptionsSchema,
    },
  },
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { renderPresentationPdf } from "../render-presentation-pdf";

const CLIENT_ID = "client-1";
const FIRM_ID = "firm-1";
const SCENARIO = "scenario-s";

const storyOptions = (over: Partial<PlanStoryOptions> = {}): PlanStoryOptions => ({
  preset: "full",
  documentRole: "standalone",
  scenarioId: "",
  sections: PLAN_STORY_OPTIONS_DEFAULT.sections,
  chapterStyle: PLAN_STORY_OPTIONS_DEFAULT.chapterStyle,
  ...over,
});

const deck = (pages: Array<{ pageId: string; options: unknown }>) =>
  ({
    scenarioId: null,
    filename: undefined,
    preview: false,
    pages: pages.map((p) => ({ ...p, scenarioOverride: undefined })),
  }) as unknown as ExportPdfBody;

const COVER = { pageId: "cover", options: {} };

/** The element `renderPresentationPdf` handed to `renderToBuffer`. */
const documentPages = () =>
  renderToBufferMock.mock.calls[0][0].props.pages as Array<{
    pageId: string;
    planStory?: { text: Record<string, string> };
  }>;

beforeEach(() => {
  vi.clearAllMocks();
  renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
  // No client row → firm branding. Keeps the only DB call in this function
  // out of the way of what is being asserted.
  dbMocks.select.mockReturnValue({ from: dbMocks.from });
  dbMocks.from.mockReturnValue({ where: dbMocks.where });
  dbMocks.where.mockResolvedValue([]);
  storyMocks.loadStoryScenarioLabel.mockImplementation(async (_c: string, id: string) =>
    id === "" || id === "base" ? "Base Case" : `Name of ${id}`,
  );
  // A deliberate identity: each payload names the options it was loaded from,
  // so the ASSIGNMENT of payloads to pages is observable.
  storyMocks.loadPlanStoryInput.mockImplementation(
    async (_c: string, _f: string, o: { scenarioId: string; documentRole: string }) => ({
      story: {},
      text: { planInOnePage: `story for ${o.scenarioId || "base"} as ${o.documentRole}` },
    }),
  );
});

describe("renderPresentationPdf — Plan Story wiring", () => {
  it("loads no story for a deck that has no Plan Story page", async () => {
    await renderPresentationPdf(CLIENT_ID, FIRM_ID, deck([COVER]));

    expect(storyMocks.loadPlanStoryInput).not.toHaveBeenCalled();
    expect(storyMocks.loadStoryScenarioLabel).not.toHaveBeenCalled();
    expect(documentPages()[0].planStory).toBeUndefined();
  });

  /**
   * X7, first half: the page being in the deck is what triggers the load, and
   * the payload reaches the document. The options are passed straight through —
   * `pageDescriptorSchema` already parsed and defaulted them (correction 7) —
   * and the label is resolved from the SAME entry's scenarioId (X4).
   */
  it("hands the document a payload for the Plan Story page", async () => {
    await renderPresentationPdf(
      CLIENT_ID,
      FIRM_ID,
      deck([COVER, { pageId: "planStory", options: storyOptions({ scenarioId: SCENARIO }) }]),
    );

    expect(storyMocks.loadStoryScenarioLabel).toHaveBeenCalledWith(CLIENT_ID, SCENARIO);
    // The WHOLE options object, not a hand-picked subset. The loader reads
    // `sections` to decide which chapters' facts it has to load, so an entry
    // that arrived without them would skip the life-cover solve for a deck that
    // prints the chapter — which prints an empty state, silently.
    expect(storyMocks.loadPlanStoryInput).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, {
      ...storyOptions({ scenarioId: SCENARIO }),
      scenarioLabel: `Name of ${SCENARIO}`,
    });

    const pages = documentPages();
    expect(pages[0].planStory).toBeUndefined();
    expect(pages[1].planStory?.text.planInOnePage).toBe(
      `story for ${SCENARIO} as standalone`,
    );
  });

  /**
   * I2. Kills `body.pages.find(…)` plus a single shared payload: that shape
   * loads ONCE and gives the full story page the brief's story — the brief's
   * subtitle, the brief's `frontMatter` narration, and chapter text read from
   * the "base" storage scope instead of the scenario's, so the advisor's
   * reviewed recommendation silently does not print. Page counts stay right,
   * which is what makes it invisible.
   */
  it("gives each Plan Story entry the story its OWN options name", async () => {
    await renderPresentationPdf(
      CLIENT_ID,
      FIRM_ID,
      deck([
        COVER,
        {
          pageId: "planStory",
          options: storyOptions({ preset: "brief", documentRole: "frontMatter" }),
        },
        { pageId: "planStory", options: storyOptions({ scenarioId: SCENARIO }) },
      ]),
    );

    expect(storyMocks.loadPlanStoryInput).toHaveBeenCalledTimes(2);
    expect(storyMocks.loadStoryScenarioLabel.mock.calls.map((c) => c[1])).toEqual([
      "",
      SCENARIO,
    ]);

    const pages = documentPages();
    expect(pages[1].planStory?.text.planInOnePage).toBe("story for base as frontMatter");
    expect(pages[2].planStory?.text.planInOnePage).toBe(
      `story for ${SCENARIO} as standalone`,
    );
  });

  /**
   * X7, second half. There is no catch around either call, so a failure fails
   * the export — the callers already map that to 404/422/500 or a failed run
   * row. `renderToBuffer` never running is the part that matters: a swallowed
   * failure would produce a real PDF with a real, wrong contents page.
   */
  it.each([
    ["the story load", storyMocks.loadPlanStoryInput],
    ["the scenario-label lookup", storyMocks.loadStoryScenarioLabel],
  ])("fails the export when %s rejects, producing no PDF", async (_name, dep) => {
    dep.mockRejectedValue(new Error("story unavailable"));

    await expect(
      renderPresentationPdf(
        CLIENT_ID,
        FIRM_ID,
        deck([COVER, { pageId: "planStory", options: storyOptions({ scenarioId: SCENARIO }) }]),
      ),
    ).rejects.toThrow("story unavailable");

    expect(renderToBufferMock).not.toHaveBeenCalled();
  });
});
