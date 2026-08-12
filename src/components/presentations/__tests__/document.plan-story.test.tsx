// Task 16 / I2: `PresentationDocument` hands each page the story loaded for
// THAT entry.
//
// The other half of the duplicate-Plan-Story defect. The export helper can load
// one payload per entry and this file can still deliver the first one to every
// page — which prints the wrong subtitle, narrates the wrong `documentRole` and
// reads chapter text from the wrong storage scope, all at the correct page
// count. Silent, so only an assertion catches it.
//
// The component is invoked directly rather than rendered: it is a plain
// function with no hooks, and building its element tree eagerly runs
// `buildData` for every page, which is the thread under test. No PDF renderer,
// no fonts, no react-pdf.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BuildDataContext } from "../registry";
import type { PlanStoryContextInput } from "@/lib/presentations/pages/plan-story/view-model";

const pageMocks = vi.hoisted(() => ({ buildData: vi.fn(() => ({})) }));

vi.mock("../shared/fonts", () => ({ ensureFontsRegistered: vi.fn() }));

vi.mock("../registry", () => ({
  PRESENTATION_PAGES: {
    planStory: {
      id: "planStory",
      title: "Plan Story",
      category: "Framing",
      estimatePageCount: () => 1,
      buildData: pageMocks.buildData,
      renderPdf: () => null,
    },
  },
}));

import { PresentationDocument } from "../document";

const story = (label: string): PlanStoryContextInput =>
  ({ story: { scenarioLabel: label }, text: {} }) as unknown as PlanStoryContextInput;

const bundle = {
  clientData: {},
  projection: { years: [] },
  scenarioLabel: "Base Case",
} as never;

const props = (pages: Array<{ planStory?: PlanStoryContextInput }>) =>
  ({
    pages: pages.map((p) => ({ pageId: "planStory", options: {}, scenarioKey: "base", ...p })),
    firmName: "Foundry Planning",
    firmTagline: null,
    firmLogoDataUrl: null,
    accentColor: "#b87f1f",
    clientName: "Cooper Sample",
    reportDate: "August 12, 2026",
    spouseName: null,
    spouseLastName: null,
    headerName: "Cooper Sample",
    bundles: { base: bundle },
    topScenarioKey: "base",
  }) as never;

/** The `planStory` each page's `buildData` was given, in document order. */
const deliveredLabels = () =>
  pageMocks.buildData.mock.calls.map(
    (c) => ((c as unknown as [BuildDataContext])[0].planStory?.story.scenarioLabel) ?? null,
  );

beforeEach(() => {
  pageMocks.buildData.mockClear();
});

describe("PresentationDocument — Plan Story payloads", () => {
  it("gives each Plan Story page the story loaded for that entry", () => {
    PresentationDocument(props([{ planStory: story("Base Case") }, { planStory: story("New Plan") }]));

    expect(deliveredLabels()).toEqual(["Base Case", "New Plan"]);
  });

  /**
   * The `undefined` branch is real — `buildPlanStoryData` renders its
   * "story isn't available" page for it — so it has to reach `buildData` as
   * `undefined` rather than as a neighbour's payload.
   */
  it("passes nothing for a page the caller supplied no story for", () => {
    PresentationDocument(props([{}, { planStory: story("New Plan") }]));

    expect(deliveredLabels()).toEqual([null, "New Plan"]);
  });
});
