// The export path's only story dependency. Reads the advisor-reviewed text out
// of storage and rebuilds the context the deterministic fallbacks need. It
// makes NO model call: an export must never be slower, more expensive, or less
// predictable because a chapter happened to be missing.
import { loadStoryContext } from "./load-context";
import { listStoryChapters, resolveChapterText } from "./repo";
import { isChapterId, type ChapterId } from "./types";
import {
  planStoryProposedRef,
  printedChapters,
  type PlanStoryOptions,
} from "@/lib/presentations/pages/plan-story/options-schema";
import type { PlanStoryContextInput } from "@/lib/presentations/pages/plan-story/view-model";

export async function loadPlanStoryInput(
  clientId: string,
  firmId: string,
  /** The PAGE's own parsed options — the whole object, not a hand-picked
   *  subset, so the print list below is derived here rather than passed in —
   *  plus the one thing the options cannot carry. */
  options: PlanStoryOptions & {
    /** X4: the scenario's DISPLAY NAME, resolved by the caller
     *  (`scenario-label.ts`). Never invented here. */
    scenarioLabel: string;
  },
): Promise<PlanStoryContextInput> {
  // X1: ONE spelling of the proposed-ref rule, imported. Three derivations of it is
  // how the page-count defect comes back — the loader and `printedChapters` must agree.
  const proposedRef = planStoryProposedRef(options.scenarioId);

  const [story, rows] = await Promise.all([
    loadStoryContext({
      clientId,
      firmId,
      proposedRef,
      scenarioLabel: options.scenarioLabel,
      documentRole: options.documentRole,
      // The SAME call the render makes to decide what to print, so the loader
      // cannot skip facts a chapter on this deck is about to need. Computed
      // here, off the options, rather than handed in by the caller — a second
      // derivation of the print list is exactly how the page-count defect came
      // back twice, and here it would print an empty state instead.
      chapters: printedChapters(options),
    }),
    // NOTE: this is the STORAGE scope, a different thing from the proposed ref
    // above. `planStoryProposedRef` maps both "" and "base" to null, while
    // storage keys both on the literal "base" — the value the review panel
    // translates to and both write routes reach through `resolveStoryScenarioId`.
    // Reading "" here would find no rows and quietly print deterministic prose
    // over the advisor's own writing.
    //
    // Since 0240 the scope also carries the ROLE, so a deck holding the brief up
    // front AND the full story later reads two different sets of rows rather
    // than printing one set twice.
    listStoryChapters(clientId, options.scenarioId || "base", options.documentRole),
  ]);

  const text: Partial<Record<ChapterId, string>> = {};
  for (const row of rows) {
    // A stored row for a chapter this build no longer has. Logged rather than
    // dropped in silence: it means either a rename that needs a data migration
    // or a chapter retired with rows still under it, and both are things
    // somebody has to know about. Never fatal — an export must not fail because
    // storage remembers more than the code does.
    if (!isChapterId(row.chapterId)) {
      console.warn("[plan-story] stored row for an unknown chapter, ignored:", row.chapterId);
      continue;
    }
    // "" means "nothing stored" — the view-model then narrates deterministically
    // rather than printing an empty chapter. A row can hold no words at all:
    // marking a chapter reviewed creates one.
    const resolved = resolveChapterText(row, "");
    if (resolved.length > 0) text[row.chapterId] = resolved;
  }

  return { story, text };
}
