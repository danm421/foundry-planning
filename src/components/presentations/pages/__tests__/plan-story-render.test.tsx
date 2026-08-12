// A real @react-pdf render of the story pages. Two things are invisible to
// every other test in this suite and only the layout engine can see them:
//
//   1. react-pdf auto-breaks a `<Page>` whose content exceeds the content box,
//      producing MORE physical sheets than `estimatePlanStoryPageCount`
//      reserved. `document.tsx` numbers the rest of the deck from that estimate,
//      so an extra sheet mis-numbers every page after the story.
//   2. An unregistered font FAMILY throws mid-render (measured: renaming
//      "Fraunces" fails this file, and nothing else in the suite notices). An
//      unregistered WEIGHT does not — react-pdf falls back silently — so
//      `title`'s 600 is a house-style choice no test can hold it to.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { estimatePlanStoryPageCount } from "@/lib/presentations/pages/plan-story/estimate-page-count";
import { PLAN_STORY_OPTIONS_DEFAULT, type PlanStoryOptions } from "@/lib/presentations/pages/plan-story/options-schema";
import type { PlanStoryPageData } from "@/lib/presentations/pages/plan-story/view-model";
import { PlanStoryPagePdf } from "../plan-story/page-pdf";

ensureFontsRegistered();

const FRAME = {
  firmName: "Foundry Wealth",
  clientName: "Alan & Teresa",
  reportDate: "August 12, 2026",
  pageIndex: 1,
  totalPages: 3,
  accent: DEFAULT_ACCENT,
};

/** The PDF's page-tree node — `<< /Type /Pages /Count n /Kids […] >>`, written
 *  uncompressed by pdfkit. The count react-pdf actually laid out, not the one we
 *  asked for. */
function renderedPages(pdf: Buffer): number {
  const match = /\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no page-tree node in the rendered PDF");
  return Number(match[1]);
}

async function pagesOf(data: PlanStoryPageData): Promise<number> {
  return renderedPages(
    await renderToBuffer(<Document>{PlanStoryPagePdf({ data, ...FRAME })}</Document>),
  );
}

/** A full proposed story at the length the chapter narrators actually write. */
const REALISTIC: PlanStoryPageData = {
  title: "Your Plan",
  subtitle: "Proposed — Retire at 63",
  isEmpty: false,
  emptyMessage: "",
  chapters: [
    {
      chapterId: "planInOnePage",
      title: "Your plan, in one page",
      layout: "heroProse",
      paragraphs: [
        "With the changes we're suggesting, the plan comes through in 91% of the futures we tested — up from 84% on your current path.",
        "That comes from two changes: Delay Social Security and Roth conversions.",
        "You're starting from $2.4M.",
      ],
      strategies: [],
    },
    {
      chapterId: "whatYouHave",
      title: "What you have",
      layout: "heroProse",
      paragraphs: [
        "You own $2.9M and owe $480K, which leaves $2.4M to your name.",
        "Not all of it is spendable: $1.6M sits in retirement accounts you can't reach without tax, and $620K is the house you live in.",
      ],
      strategies: [],
    },
    {
      chapterId: "whatWeRecommend",
      title: "What we're recommending, and why",
      layout: "strategyCards",
      paragraphs: ["Two changes, and both are about timing rather than about taking more risk."],
      strategies: [
        { name: "Delay Social Security", what: "Alan's Social Security claim age", detail: "Claim age: 67 → 70" },
        {
          name: "Roth conversions",
          what: "Traditional IRA → Roth IRA, Teresa's Traditional IRA → Roth IRA",
          detail: "$50K/yr from Traditional IRA → Roth IRA · 2028–2033",
        },
      ],
    },
  ],
};

describe("Plan Story — real PDF render", () => {
  it("lays out one sheet per chapter, and no more", async () => {
    const proposed: PlanStoryOptions = { ...PLAN_STORY_OPTIONS_DEFAULT, scenarioId: "scn-1" };
    expect(await pagesOf(REALISTIC)).toBe(estimatePlanStoryPageCount(undefined, proposed));
  }, 30_000);

  it("lays out the single sheet the empty state reserves", async () => {
    const empty: PlanStoryPageData = {
      title: "Your Plan",
      subtitle: "Base Case",
      isEmpty: true,
      emptyMessage: "The plan story isn't available for this report.",
      chapters: [],
    };
    expect(await pagesOf(empty)).toBe(1);
  }, 30_000);
});
