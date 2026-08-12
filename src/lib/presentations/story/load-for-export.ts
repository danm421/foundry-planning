// The export path's only story dependency. Reads the advisor-reviewed text out
// of storage and rebuilds the context the deterministic fallbacks need. It
// makes NO model call: an export must never be slower, more expensive, or less
// predictable because a chapter happened to be missing.
import { loadStoryContext } from "./load-context";
import { listStoryChapters, resolveChapterText } from "./repo";
import type { ChapterId } from "./types";
import { planStoryProposedRef } from "@/lib/presentations/pages/plan-story/options-schema";
import type { PlanStoryContextInput } from "@/lib/presentations/pages/plan-story/view-model";

export async function loadPlanStoryInput(
  clientId: string,
  firmId: string,
  options: {
    scenarioId: string;
    documentRole: "standalone" | "frontMatter";
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
    }),
    // NOTE: this is the STORAGE scope, a different thing from the proposed ref
    // above. `planStoryProposedRef` maps both "" and "base" to null, while
    // storage keys both on the literal "base" — the value the review panel
    // translates to and both write routes reach through `resolveStoryScenarioId`.
    // Reading "" here would find no rows and quietly print deterministic prose
    // over the advisor's own writing.
    listStoryChapters(clientId, options.scenarioId || "base"),
  ]);

  const text: Partial<Record<ChapterId, string>> = {};
  for (const row of rows) {
    // "" means "nothing stored" — the view-model then narrates deterministically
    // rather than printing an empty chapter. A row can hold no words at all:
    // marking a chapter reviewed creates one.
    const resolved = resolveChapterText(row, "");
    if (resolved.length > 0) text[row.chapterId as ChapterId] = resolved;
  }

  return { story, text };
}
