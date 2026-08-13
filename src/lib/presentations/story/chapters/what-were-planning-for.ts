// Chapter 1 — the people and the goals, before any dollar.
//
// The spec's reason for this chapter existing: opening on a balance sheet makes
// the reader a spectator; opening on their own dates and what they want the
// money to DO makes them the subject. So this narrator's job is to name things
// the household typed, and to put almost no figures on the page.
import { quotableDetail } from "./what-we-recommend";
import { goalYearFactId } from "../build-facts";
import type { Fact } from "../facts";
import { factDisplay, factsForChapter, type StoryContext, type StoryGoal } from "../types";
import { validateNoAdvice } from "../validate/readability";

/**
 * Two sentences rather than one, and both short.
 *
 * A single long apology averaged 23 words against Gate 2's limit of 20, and the
 * three-sentence version that replaced it scored 0.07 on Gate 4's rhythm rule
 * against a floor of 0.122 — this chapter's fallback is the shortest text in the
 * report, so it has the least room to absorb an even cadence. Measured, not
 * guessed; `__tests__/what-were-planning-for.test.ts` runs the gates on it.
 */
const NOTHING_YET = [
  "We don't have your goals written down yet.",
  "That's worth an hour of our next conversation — what you want the money to do shapes everything else in the plan.",
];

/**
 * A goal's name is text the household typed, so it can carry a figure we never
 * formatted ("$50k for the boat"). Same rule as every other borrowed string:
 * quotable or dropped. The GOAL is not dropped — its name is, and with it the
 * only thing this chapter had to say about that goal.
 *
 * Scoped to this chapter's figures, not the whole pack, exactly as
 * `narrateWhatWeRecommend` scopes its own grounding. An unscoped check would let
 * a goal called "$4.5M someday" print because some other chapter's fact happens
 * to spell $4.5M.
 */
function safeName(goal: StoryGoal, facts: Fact[]): string | null {
  return quotableDetail(goal.name, facts);
}

/**
 * The year leads and the name follows — "In 2032, Maggie's college."
 *
 * Not decoration. A household goal is often written as an instruction ("Move to
 * Florida", "Sell the rental"), and Gate 3 reads a bare action verb at the START
 * of a clause as a command to the reader whatever follows it. Putting the date
 * in front makes the name a non-initial clause, where the same gate asks for an
 * object it can recognise and finds none. Goals with no date have no such
 * shelter, which is what `readsAsInstruction` below is for.
 */
function goalSentence(goal: StoryGoal, name: string, year: string | null): string {
  return year ? `In ${year}, ${name}.` : `${name}.`;
}

/** Would this sentence read as us telling the client to do something? Checked on
 *  the composed sentence rather than on the name, because the framing above is
 *  what decides the answer for most names. */
function readsAsInstruction(sentence: string): boolean {
  return validateNoAdvice(sentence, []).length > 0;
}

export function narrateWhatWerePlanningFor(ctx: StoryContext): string[] {
  const facts = factsForChapter(ctx.facts, "whatWerePlanningFor");
  const retire = factDisplay(ctx, "plan.retirementYear");
  const end = factDisplay(ctx, "plan.endOfLifeYear");

  const paragraphs: string[] = [];

  // The horizon, in one sentence, and only the parts we actually know. A
  // retirement year already in the past is not in the pack at all (build-facts),
  // so this branch cannot promise a date that has been and gone.
  if (retire && end) {
    paragraphs.push(`The plan runs from now to ${end}, with work ending in ${retire}.`);
  } else if (end) {
    paragraphs.push(`The plan runs from now to ${end}.`);
  } else if (retire) {
    paragraphs.push(`The plan is built around work ending in ${retire}.`);
  }

  // The year comes out of the PACK, never off `goal.year`: Gate 1 reads any
  // four-digit number as a figure, so a year printed straight from the context
  // would be ungrounded and this narrator would fail its own gate. A goal whose
  // year is missing from the pack simply prints undated, which is true.
  const sentences = ctx.goals
    .map((goal, index) => {
      const name = safeName(goal, facts);
      return name ? goalSentence(goal, name, factDisplay(ctx, goalYearFactId(index))) : null;
    })
    .filter((s): s is string => s != null && !readsAsInstruction(s));

  if (sentences.length === 0) {
    // Nothing to name, so say what the chapter is for without inventing a goal.
    paragraphs.push(...NOTHING_YET);
    return paragraphs;
  }

  // Deliberately NOT a comma list of three: Gate 4 rejects the rhetorical triad,
  // and a narrator that publishes prose its own gate would refuse makes the gate
  // unusable. One sentence per goal keeps the rhythm varied too.
  paragraphs.push("Here's what you told us the money is for.");
  paragraphs.push(...sentences);

  return paragraphs;
}
