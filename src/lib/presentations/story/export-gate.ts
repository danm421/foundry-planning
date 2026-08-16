// What an export is about to hand over that nobody has read.
//
// SOFT, and audited — the spec's decision. A hard block on a deck an advisor is
// walking into a meeting with is a feature that gets worked around, and the
// control that earns this report's lack of an "AI-generated" marker is advisor
// review, which an audit row can evidence and a blocked export cannot.
//
// Reads storage ONLY. No projection, no model call — an export must never be
// slower because of a check about it, the same rule `load-for-export.ts` states.
import { listStoryChapters, type DocumentRole } from "./repo";
import { planStoryOptionsSchema, printedChapters } from "@/lib/presentations/pages/plan-story/options-schema";
import type { PresentationPageDescriptor } from "@/lib/presentations/types";

export interface UnreviewedStoryPage {
  pageId: string;
  scenarioId: string;
  documentRole: DocumentRole;
  unreviewed: number;
  total: number;
}

export async function unreviewedStoryChapters(
  clientId: string,
  pages: PresentationPageDescriptor[],
): Promise<UnreviewedStoryPage[]> {
  const story = pages.filter((p) => p.pageId === "planStory");
  // Early, and before any query: the overwhelming majority of decks hold no
  // story page, and a check about a feature they do not use must cost them
  // nothing.
  if (story.length === 0) return [];

  return Promise.all(
    story.map(async (page) => {
      const options = planStoryOptionsSchema.parse(page.options ?? {});
      // The SAME call the render makes. A second derivation of the print list is
      // how the page-count defect came back twice; here it would count chapters
      // the deck does not contain.
      const printed = printedChapters(options);
      const rows = await listStoryChapters(clientId, options.scenarioId || "base", options.documentRole);
      const reviewed = new Set(rows.filter((r) => r.reviewedAt != null).map((r) => r.chapterId));
      return {
        pageId: page.pageId,
        scenarioId: options.scenarioId || "base",
        documentRole: options.documentRole,
        // A chapter with no row has never been reviewed — counting only the rows
        // that exist would report a story nobody has opened as fully read.
        unreviewed: printed.filter((id) => !reviewed.has(id)).length,
        total: printed.length,
      };
    }),
  );
}
