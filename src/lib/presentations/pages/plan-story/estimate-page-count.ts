// Data-independent by contract: `document.tsx` calls this as
// `estimatePageCount(undefined, options)` while it plans the deck's layout, so
// it may only read options. One page per chapter that will print, floored at one
// so the numbering never collapses on an all-off report — the renderer still
// puts an empty-state page there.
//
// `printedChapters` rather than a local count of the section toggles: the two
// differ on a base-only story, and this number is what every page after the
// story is numbered from.
import { printedChapters, type PlanStoryOptions } from "./options-schema";

export function estimatePlanStoryPageCount(_data: unknown, options: PlanStoryOptions): number {
  return Math.max(1, printedChapters(options).length);
}
