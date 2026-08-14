// Chapter 12 — the advisor's own next steps, with one paragraph of lead-in.
//
// The only chapter whose BODY this module does not write. The steps are
// advisor-authored `plan_observations` rows with their merge tokens already
// resolved (`load-next-steps.ts`), and they print verbatim beneath this
// paragraph — so everything here is ABOUT the list rather than a restatement of
// it. Say a step twice and the page says it twice.
//
// `checklist`, so the prose budget is 35 words: the steps are the chapter and
// this is a sentence of lead-in. Two sentences, which is also what keeps Gate
// 4's rhythm rule off it — that rule needs three units to fire, and there is no
// room here for a third.
//
// Deliberately the same in both registers, unlike every other chapter. A
// `frontMatter` chapter is told to point at the pages that follow, and the page
// that carries these steps in full is the Observations & Next Steps page — which
// an advisor may or may not have put in the deck. Pointing at a page that might
// not be there is the one thing a forward reference must never do.
import type { StoryContext, StoryStep } from "../types";
import { spelledCount } from "./prose";

/**
 * Nothing agreed yet, which is an ordinary state — most of these lists are
 * written in the meeting this report is being read in.
 *
 * It promises the list rather than describing an empty one, and it is one
 * sentence: below the rhythm rule's floor of three units, and well inside the
 * checklist budget.
 */
const NOTHING_YET =
  "Nothing's been written down yet — we'll agree what happens next together, and you'll have it in writing straight after.";

/** What the page prints under a step: the owner, the date, or both. The lead
 *  paragraph may only promise it when at least one step actually carries one —
 *  `chapter-pdf.tsx` prints the caption on exactly this condition. */
function anyCaption(steps: StoryStep[]): boolean {
  return steps.some((s) => s.owner.trim().length > 0 || s.when.trim().length > 0);
}

const WE_GO_THROUGH_THEM = "We'll go through each one with you.";

export function narrateWhatHappensNext(ctx: StoryContext): string[] {
  // Absent means the same as empty — a context built before this field existed,
  // or a household whose loader skipped the read.
  const steps = ctx.nextSteps ?? [];
  if (steps.length === 0) return [NOTHING_YET];

  const lead = anyCaption(steps)
    ? `Here's what happens next — ${spelledCount(steps.length, "thing", "things")} to pick up, and who's looking after each one.`
    : `Here's what happens next — ${spelledCount(steps.length, "thing", "things")} to pick up.`;

  // ONE paragraph, not two: the layout sets this straight above the numbered
  // list, and a second block of prose pushes the first step down the sheet.
  return [`${lead} ${WE_GO_THROUGH_THEM}`];
}
