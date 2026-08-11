// Inherits the shipped Retirement Comparison prompt's DNA (warm, second
// person, first names used sparingly, short paragraphs, no headings) and adds
// the fact table, the document role, the voice samples, and the retry block.
//
// Every instruction here is the model-facing half of a gate in `../validate`.
// The gates are what actually hold — this only lowers the odds of spending the
// chapter's single retry.
import type { ChangeOp, ChangeRow } from "@/lib/presentations/pages/scenario-changes/types";
import { factDisplaySet } from "../facts";
import type { GateFailure } from "../validate";
import { extractFigures } from "../validate/facts";
import type { ChapterId, StoryContext } from "../types";
import { CHAPTERS } from "./registry";

/** Gate 3's banned openers, in full. Copied rather than imported: `ACTION_VERBS`
 *  is private to `validate/readability.ts`, and this module may not reach into
 *  that file to export it. The suite pins the copy — every word named here is
 *  proved to be one the gate actually rejects. */
const ACTION_WORDS =
  "buy, sell, purchase, liquidate, move, switch, shift, trim, rebalance, reallocate, convert, roll, invest";

const OP_WORD: Record<ChangeOp, string> = { add: "added", remove: "removed", edit: "changed" };

/**
 * A `ChangeRow` is written for the Scenario Changes table by a formatter this
 * module does not own, so its figures are in that page's house style and are
 * not in the fact pack — a year ("Sold in 2029") and a dollar ("$50k/yr") are
 * both figures under Gate 1. Handing one to the model and telling it not to
 * copy it spends the chapter's single retry on a word we chose to show it.
 * `types.ts` states the rule: text this module did not build is quotable only
 * when every figure in it is one the pack supplied, spelled the pack's way.
 */
function quotable(text: string, spellings: Set<string>): boolean {
  return extractFigures(text).every((figure) => spellings.has(figure));
}

/**
 * `what-we-recommend.ts` refuses `before`/`after` for EVERY op, including an
 * edit — it prints to the client, and an edit's two values are exactly the
 * foreign-formatted figures it exists to keep off the page. This block is not
 * printed; it is background for the model, and the two values are the clearest
 * statement of what an edit did. So they are kept for an edit when the grounding
 * check clears them, and the op word carries the change on its own otherwise.
 * Deliberate divergence, not the same call.
 */
function rowLine(row: ChangeRow, spellings: Set<string>): string {
  const move =
    row.op === "edit" && quotable(`${row.before} ${row.after}`, spellings)
      ? `: ${row.before} → ${row.after}`
      : "";
  const detail = row.detail[0] && quotable(row.detail[0], spellings) ? ` — ${row.detail[0]}` : "";
  return `    - ${row.what} (${OP_WORD[row.op]})${move}${detail}`;
}

export function buildChapterPrompt(
  chapterId: ChapterId,
  ctx: StoryContext,
  voiceSamples: string[],
  retryFailures: GateFailure[],
): { system: string; user: string } {
  const def = CHAPTERS[chapterId];

  const systemParts = [
    "You are a financial advisor writing one short chapter of a plan you are handing to your own client.",
    "Write the way you would talk to them across a table: warm, direct, second person, contractions, no corporate voice.",
    `Use their first names (${ctx.household.firstNames}) once at most — more sounds like a mail merge.`,
    // The last sentence is Gate 2's two numeric limits, said out loud. Without
    // them the chapter can be rejected for a rule it was never given.
    "Vary your sentence length. A short one, then a longer one. Writing where every sentence is the same length reads as machine-written. Keep the average under 20 words, and never write one past 40.",
    "Never write a three-item parallel list. Never open with a throat-clear like \"It's important to note\".",
    "Output: clean Markdown, 2 to 4 short paragraphs, no headings, no preamble.",
    "Only use the figures listed below, copied exactly as they are written. Never invent a figure, never reformat one, never compute a new one.",
    "Describe what the plan shows and why it moves. Do not tell them to buy, sell, or move anything.",
    // Gate 3 reads a clause that OPENS with one of these as an instruction
    // whatever follows it, so this is a real constraint on ordinary prose and
    // not a restatement of the line above. Every word is named: the gate holds
    // thirteen, and a partial list leaves the model free to open a clause with
    // one of the seven this document is most likely to reach for.
    `Never open a sentence or a clause with one of these action words: ${ACTION_WORDS}. Make the plan or the household the subject instead.`,
    // …and the advisor's own labels are exactly where that goes wrong: "Sell
    // the rental" and "Convert to Roth" are how toggle groups get named, and a
    // chapter that quotes one at the head of a clause is rejected for words the
    // model did not choose. The page layout prints the labels beside the prose,
    // so nothing is lost by describing them instead.
    "The advisor's own names for this plan and for each strategy are printed beside your text by the page layout. Say what each one does; never repeat a label word for word.",
    "Explain any technical term in the same sentence you use it, or leave it out.",
    ctx.documentRole === "frontMatter"
      ? "This chapter opens a longer report. Where there is more detail, point at the pages that follow rather than covering it here."
      : "This chapter stands on its own. Close the thought — nothing follows it.",
  ];

  if (voiceSamples.length > 0) {
    systemParts.push(
      "Match the voice of these samples of the advisor's own writing. Copy their rhythm and register, not their content:",
      ...voiceSamples.map((s) => `Sample: ${s}`),
    );
  }

  // No fact pack is not "no rule": say so, rather than leaving a bare heading
  // over an empty list for the model to read as permission.
  const factBlock =
    ctx.facts.length > 0
      ? ["The only figures you may use:", ctx.facts.map((f) => `- ${f.label}: ${f.display}`).join("\n")]
      : ["You have no figures for this chapter. Write it without any numbers at all."];

  // Every figure that survives `rowLine` is one the fact pack supplied, so the
  // block needs no instruction about figures — only about the labels, which are
  // the advisor's own wording and the one thing here that must not be quoted.
  const spellings = factDisplaySet(ctx.facts);
  const strategyBlock =
    chapterId === "whatWeRecommend" && ctx.strategies.length > 0
      ? [
          "",
          "The changes, grouped as strategies. The names are the advisor's own wording — say what each change does rather than quoting them:",
          ...ctx.strategies.flatMap((s) => [`- ${s.name}`, ...s.rows.map((r) => rowLine(r, spellings))]),
        ]
      : [];

  const retryBlock =
    retryFailures.length > 0
      ? ["", "Your last attempt broke these rules. Fix all of them:", ...retryFailures.map((f) => `- ${f.message}`)]
      : [];

  const user = [
    `Household: ${ctx.household.householdName} — ${ctx.household.firstNames}.`,
    `Plan being presented: "${ctx.scenarioLabel}".`,
    "",
    `This chapter — "${def.title}": ${def.brief}`,
    "",
    ...factBlock,
    ...strategyBlock,
    ...retryBlock,
    "",
    "Write the chapter now.",
  ].join("\n");

  // One instruction per line. The shipped comparison prompt joins with a space,
  // but it has no sub-blocks; here two multi-sentence voice samples run into
  // each other and into the rule above them when they share a paragraph.
  return { system: systemParts.join("\n"), user };
}
