// src/lib/presentations/pages/scenario-comparison/ai-prompt.ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { fmtUsdCompact } from "./format";
import type { GainCost, TradeoffBand } from "./types";

/** Structured-output contract. Where a field in a structured-output schema is
 *  genuinely optional it must be `.nullable()`, NOT `.optional()` — an optional
 *  field has silently produced a missing key in this codebase before. Every
 *  field here is required, so neither applies. */
export const NarrativesSchema = z.object({
  narratives: z.array(
    z.object({
      scenarioId: z.string(),
      paragraph: z.string(),
    }),
  ),
});
export type Narratives = z.infer<typeof NarrativesSchema>;

const TONE: Record<"concise" | "detailed" | "plain", string> = {
  concise: "Lead with the single most important point. Trim every word you can.",
  detailed: "Bring in specific numbers where they sharpen the point. Don't pad.",
  plain: "Use everyday language. No jargon at all.",
};

/**
 * Bumped whenever the SYSTEM prompt's instructions change in a way that should
 * rewrite existing narratives — not for a typo.
 *
 * It is part of every band's staleness hash, so a revision regenerates the
 * paragraphs on the next export instead of leaving a deck in which some bands
 * were written to the old instructions and some to the new. Without it a
 * prompt change is invisible on every plan whose numbers have not moved.
 *
 * 1 — the original instructions: one paragraph per scenario, naming what it
 *     buys and what it gives up.
 * 2 — narratives must explain the mechanism and the tax character of what the
 *     heirs inherit, and stop re-listing the Gains/Costs strip.
 * 3 — a $0 inherited-asset tax is read as a RESULT, not as a gap. Version 2
 *     told the model a $0 column meant the tax was unmodelled, which printed
 *     "no heir income tax was modeled in this column" on a plan whose full
 *     Roth conversion had left the heirs nothing taxable — the strongest thing
 *     that plan did for the next generation, reported as a missing number.
 */
const PROMPT_VERSION = "3";

export interface BandHashInput {
  scenarioId: string;
  name: string;
  gains: GainCost[];
  costs: GainCost[];
  changeLines: string[];
  tone: string;
  customInstructions: string;
  sentenceBudget: number;
  /** This column's own inherited-asset income tax, or null when the household
   *  has no estate report. 0 and null are deliberately distinct: a $0 column
   *  alongside a taxed one licenses a sentence ("your heirs owe nothing on
   *  this") that a null never does. Base Case's figure moving does NOT restale
   *  a band — the same deliberate limit the matrix numbers have, see below. */
  heirIncomeTax: number | null;
}

/**
 * Staleness hash for ONE band, computed from that band's own facts.
 *
 * Deliberately NOT a hash of the assembled prompt. The prompt names every
 * column, so a shared hash would go stale — and regenerate all three bands,
 * discarding the advisor's edits on two of them — whenever any single number
 * anywhere on the sheet moved.
 */
export function hashBand(input: BandHashInput): string {
  const h = createHash("sha256");
  h.update(input.scenarioId).update(" ");
  h.update(input.name).update(" ");
  for (const g of input.gains) h.update(`+${g.label}=${g.amount} `);
  for (const c of input.costs) h.update(`-${c.label}=${c.amount} `);
  for (const l of input.changeLines) h.update(`~${l} `);
  h.update(input.tone).update(" ");
  h.update(input.customInstructions).update(" ");
  h.update(String(input.sentenceBudget)).update(" ");
  h.update(String(input.heirIncomeTax)).update(" ");
  h.update(PROMPT_VERSION);
  return h.digest("hex");
}

export interface ScenarioComparisonAiArgs {
  householdName: string;
  firstNames: string;
  tone: "concise" | "detailed" | "plain";
  customInstructions: string;
  sentenceBudget: number;
  /** Every band on the sheet — including ones that are not stale, so the model
   *  can contrast them. Only stale bands' responses are kept. */
  bands: Array<Pick<TradeoffBand, "scenarioId" | "name" | "changeLines" | "gains" | "costs">>;
  /** One line per metric row, naming every column. */
  matrixLines: string[];
  /** Per column, the income tax the heirs owe on the pre-tax balances they
   *  inherit — already deducted from the Net to heirs row. `null` is a column
   *  with no estate report to read. Handed over as NUMBERS, not lines, because
   *  the instruction that reads them turns on whether any column is above zero
   *  — see `heirTaxBlock`. */
  heirTaxes: Array<{ name: string; amount: number | null }>;
}

/**
 * The second-order consequences a scenario's changes carry that no column on
 * the sheet has a row for.
 *
 * A MENU, not a script — which is why MECHANISMS_LEAD_IN gates each entry on
 * the scenario's own change list. Every one of them is a statement about how
 * the tax rules work, not about what this projection computed, so nothing here
 * may carry a figure. The inherited-money entry is why `heirTaxes` exists:
 * whether the report actually deducted that tax is a fact about the household,
 * and the model has to read it rather than assume it.
 */
const MECHANISMS_LEAD_IN =
  "Below is what those consequences usually are. Reach for one ONLY when this scenario's own change list contains the change it belongs to, describe it as how the rules work rather than as something extra the report calculated, and never attach a figure to it.";

const MECHANISMS = [
  "(a) A Roth conversion pays income tax now, at today's brackets, so what is converted grows and is later withdrawn tax-free, and it shrinks the required minimum distributions that would otherwise be forced out later. It moves a bill forward; it does not make one disappear.",
  "(b) What the next generation inherits is not all the same kind of money. A Roth balance passes to heirs income-tax-free. A pre-tax retirement balance does not — heirs owe ordinary income tax as they draw it down, on top of any estate tax. Two plans can leave the same headline dollars and hand over very different after-tax amounts.",
  "(c) Moving to a state with no income tax removes state income tax on ordinary income and on anything converted after the move; it does not change federal tax, and state estate or inheritance rules still turn on residency and on where property sits.",
  "(d) Conversions made before Social Security and required minimum distributions begin fill the lower brackets; the same conversion made later stacks on top of that income.",
];

/**
 * The inherited-asset tax block, and the instruction that tells the model what
 * it means — or null, which drops both.
 *
 * Gated on at least one column being ABOVE zero, which is the only evidence in
 * hand that this household's inherited-asset tax is modelled at all: the rate
 * is a plan setting, so a figure anywhere proves it is set, and a $0 elsewhere
 * is then a result rather than a blank. With every column at $0 the two causes
 * — nothing pre-tax passes, and no rate set — are indistinguishable, and
 * saying nothing is the only honest option.
 */
function heirTaxBlock(
  heirTaxes: ScenarioComparisonAiArgs["heirTaxes"],
): { instruction: string; userLines: string[] } | null {
  if (!heirTaxes.some((h) => h.amount != null && h.amount > 0)) return null;
  return {
    instruction:
      "The income tax the heirs owe on the pre-tax retirement balances they inherit is given below per column, and the Net to heirs row is ALREADY NET of it — that row is what the next generation actually keeps. A column showing $0 means the heirs owe no income tax on what they inherit under that plan, which is often the strongest thing that plan does for them and is worth naming. Write about the household's money, never about the report: no wording about what was or was not modelled, estimated, calculated, shown or missing.",
    userLines: [
      "",
      "Income tax the heirs owe on the pre-tax retirement balances they inherit — already deducted from the Net to heirs row above:",
      ...heirTaxes.map(
        (h) => `- ${h.name}: ${h.amount == null ? "unavailable" : fmtUsdCompact(h.amount)}`,
      ),
    ],
  };
}

export function buildScenarioComparisonAiPrompt(
  args: ScenarioComparisonAiArgs,
): { system: string; user: string } {
  const heirTax = heirTaxBlock(args.heirTaxes);
  const systemParts = [
    "You write advisor commentary for a financial-planning report.",
    'Always sound warm, personable, and conversational — like you\'re talking with the household, not at them. Use "you" and "your". Skip corporate-speak and jargon.',
    `Address the household by first name where it sounds natural (${args.firstNames}). Once or twice across the whole response is plenty.`,
    "You are given several scenarios compared against the household's current plan (Base Case).",
    "Write ONE short paragraph per scenario explaining the TRADEOFF that scenario makes: what it buys, what it gives up, and briefly why — the mechanism, not just the direction.",
    "Where it sharpens the point, contrast one scenario against another by name. That contrast is the reason you see all of them at once.",
    "The scenario's gains and costs are ALREADY PRINTED, in full, directly beneath your paragraph. Re-listing them wastes the only room you have. Name at most one or two figures, and only where a number is what makes the sentence land — then spend the rest of your words on what the reader cannot see: why the plan moved, and what it means for them.",
    "Go one step past the table. A scenario's changes have consequences the columns do not have a row for — who ends up paying tax and when, what kind of dollars are left at the end, what happens to the money after the household is gone. Name the one that matters most for this scenario.",
    MECHANISMS_LEAD_IN,
    ...MECHANISMS,
    "Only use numbers from the data below. Never invent figures.",
    "The gains and costs listed under each scenario are computed from the report's own table. Do not contradict them, and do not claim a gain or cost that is not listed.",
    "Attribute movement to a scenario's changes AS A SET. The data gives no per-change breakdown, so never assign a specific dollar or percentage figure to any single change.",
    "Format every dollar amount as $X.XM or $XXX K. Format percentages with at most one decimal place.",
    "Frame observations and risks. Do not give individualized advice or recommendations.",
    `Each paragraph must be at most ${args.sentenceBudget} sentences. Do not exceed this — the report has a fixed amount of room and longer text is cut.`,
    TONE[args.tone],
    "Return one entry per scenario, echoing the scenarioId you were given.",
  ];
  if (heirTax) systemParts.push(heirTax.instruction);
  if (args.customInstructions.trim().length > 0) {
    systemParts.push(`Advisor instructions: ${args.customInstructions.trim()}`);
  }

  const fmt = (xs: GainCost[]) =>
    xs.length ? xs.map((x) => `${x.amount} ${x.label}`).join(" | ") : "(none)";

  const bandBlocks = args.bands.map((b) => {
    const changes = b.changeLines.length
      ? b.changeLines.map((l) => `  - ${l}`).join("\n")
      : "  - (No changes recorded.)";
    return [
      `Scenario "${b.name}" (scenarioId: ${b.scenarioId})`,
      "  Changes vs. the current plan:",
      changes,
      `  Gains: ${fmt(b.gains)}`,
      `  Costs: ${fmt(b.costs)}`,
    ].join("\n");
  });

  const user = [
    `Household: ${args.householdName}.`,
    "",
    "Comparison table (every column, Base Case first):",
    ...args.matrixLines.map((l) => `- ${l}`),
    ...(heirTax?.userLines ?? []),
    "",
    ...bandBlocks,
    "",
    "Write one paragraph per scenario now.",
  ].join("\n");

  return { system: systemParts.join(" "), user };
}
