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
 * The changes table's own shorthand for a value it is not printing, from
 * `describe/generic.ts` (`addRow`, `removeRow`, and the multi-field `editRow`)
 * and the estate and savings kinds. None of them names anything, so a pair
 * built from one — "— → Updated" — says strictly nothing in prose.
 */
const PLACEHOLDER_VALUE = /^(?:[—–-]|added|removed|updated|in plan)$/iu;

const MAGNITUDE: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
/** Every shape `fmtValue` → `compactCurrency` produces, whole: `$1.5k`, `$25k`,
 *  `$2.1M`, `($1.5k)` for a negative, `4.5%`, `2032`, `67`. Anchored on purpose
 *  — a compound like "$300k · 4.50% · $1.8k/mo" must yield no direction at all
 *  rather than a direction read off its first number. */
const NUMERIC_VALUE_RE = /^\(?\$?-?([\d,]+(?:\.\d+)?)([kmb])?%?\)?$/iu;

function numericValue(text: string): number | null {
  const raw = text.trim().replace(/\s/gu, "");
  const match = NUMERIC_VALUE_RE.exec(raw);
  if (!match) return null;
  const value = Number(match[1].replace(/,/gu, "")) * (match[2] ? MAGNITUDE[match[2].toLowerCase()] : 1);
  if (!Number.isFinite(value)) return null;
  // The regex is anchored, so a sign can only be at the head — and a negative
  // is parenthesised, which is how `compactCurrency` writes one.
  return raw.startsWith("(") || raw.includes("-") ? -value : value;
}

/** Two values are only comparable in the same unit: `$20k` against `25%` is not
 *  a rise, it is a mistake. */
function unitOf(text: string): string {
  if (text.includes("$")) return "money";
  if (text.includes("%")) return "percent";
  return /^(?:19|20)\d{2}$/u.test(text.trim()) ? "year" : "plain";
}

/**
 * What an edit did, in one word. The chapter is asked for the mechanism by
 * which each change moves the numbers, and `$1.5k → $2.0k` is suppressed
 * whenever the two values are in the table's spelling rather than the pack's —
 * which is the single-field edit path, the app's most common one. Without this
 * the model cannot tell up from down.
 */
function editWord(before: string, after: string): string {
  const from = numericValue(before);
  const to = numericValue(after);
  if (from === null || to === null || from === to || unitOf(before) !== unitOf(after)) return "changed";
  if (unitOf(before) === "year") return to > from ? "moved later" : "moved earlier";
  return to > from ? "raised" : "lowered";
}

/**
 * `what-we-recommend.ts` refuses `before`/`after` for EVERY op, including an
 * edit — it prints to the client, and an edit's two values are exactly the
 * foreign-formatted figures it exists to keep off the page. This block is not
 * printed; it is background for the model, and the two values are the clearest
 * statement of what an edit did. Deliberate divergence, not the same call — and
 * two rules keep it safe: the pair is shown only when both sides name something
 * and every figure in them is the pack's, and the word before it says which way
 * the change went either way.
 */
function rowLine(row: ChangeRow, spellings: Set<string>): string {
  const named = !PLACEHOLDER_VALUE.test(row.before.trim()) && !PLACEHOLDER_VALUE.test(row.after.trim());
  const isEdit = row.op === "edit";
  const word = isEdit && named ? editWord(row.before, row.after) : OP_WORD[row.op];
  const move =
    isEdit && named && quotable(`${row.before} ${row.after}`, spellings)
      ? `: ${row.before} → ${row.after}`
      : "";
  const detail = row.detail[0] && quotable(row.detail[0], spellings) ? ` — ${row.detail[0]}` : "";
  return `    - ${row.what} (${word})${move}${detail}`;
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

  // `rowLine` grounds the two fields that carry the describers' formatted
  // figures: `before`/`after` and `detail[0]`. It does NOT ground `row.what` or
  // `strategy.name` — those are advisor- and household-entered text ("2019
  // Roth", a toggle-group label), the ruling requires the labels to reach the
  // model, and the system prompt's "only use the figures listed" line is what
  // covers anything they carry. So the block's own instruction is about the
  // labels, which are the one thing here that must not be quoted.
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
