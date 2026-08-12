// The one line the launcher row shows for this page.
//
// It counts what will PRINT, not what is switched on. The two differ on a
// base-only story, where the recommendation chapter is ticked and still cannot
// render: a row reading "3 chapters" above a two-page render is a small lie told
// to the advisor's face, and the page count shown beside it already says 2.
import { printedChapters, type PlanStoryOptions } from "./options-schema";

const PRESET_LABEL: Record<PlanStoryOptions["preset"], string> = {
  full: "Full story",
  brief: "Executive brief",
  custom: "Custom",
};

export function summarizePlanStoryOptions(options: PlanStoryOptions): string {
  const n = printedChapters(options).length;
  return `${PRESET_LABEL[options.preset]} · ${n} chapter${n === 1 ? "" : "s"}`;
}
