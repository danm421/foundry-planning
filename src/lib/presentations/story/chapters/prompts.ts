// Inherits the shipped Retirement Comparison prompt's DNA (warm, second
// person, first names used sparingly, short paragraphs, no headings) and adds
// the fact table, the document role, the voice samples, and the retry block.
//
// Every instruction here is the model-facing half of a gate in `../validate`.
// The gates are what actually hold — this only lowers the odds of spending the
// chapter's single retry.
import type { GateFailure } from "../validate";
import type { ChapterId, StoryContext } from "../types";
import { CHAPTERS } from "./registry";

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
    "Vary your sentence length. A short one, then a longer one. Writing where every sentence is the same length reads as machine-written.",
    "Never write a three-item parallel list. Never open with a throat-clear like \"It's important to note\".",
    "Output: clean Markdown, 2 to 4 short paragraphs, no headings, no preamble.",
    "Only use the figures listed below, copied exactly as they are written. Never invent a figure, never reformat one, never compute a new one.",
    // Gate 3 reads a clause that OPENS with an action verb as an instruction,
    // whatever follows it — so the second half of this line is a real
    // constraint on the prose, not a restatement of the first half.
    "Describe what the plan shows and why it moves. Do not tell them to buy, sell, or move anything, and never open a sentence or a clause with an action word like sell, move, convert, roll or trim — make the plan or the household the subject instead.",
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

  // A `ChangeRow` is built for the Scenario Changes table by a formatter this
  // module does not own, so its figures are in that page's house style and are
  // not in the fact pack. The model needs the rows to understand the grouping;
  // it must not lift a number out of them.
  const strategyBlock =
    chapterId === "whatWeRecommend" && ctx.strategies.length > 0
      ? [
          "",
          "The changes, grouped as strategies. Background only — every figure you write comes from the allowed figures, never from these lines:",
          ...ctx.strategies.flatMap((s) => [
            `- ${s.name}`,
            // `before`/`after` are only worth showing for an edit. On an add or
            // a remove they are the table's own shorthand — "—", "Added", "In
            // plan" — which reads as "— → Added" here and says nothing. Same
            // call `what-we-recommend.ts` makes about the same two fields.
            ...s.rows.map(
              (r) =>
                `    - ${r.what}${r.op === "edit" ? `: ${r.before} → ${r.after}` : ""}${r.detail[0] ? ` (${r.detail[0]})` : ""}`,
            ),
          ]),
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
