// src/lib/presentations/pages/scenario-comparison/ai-prompt.ts
import { createHash } from "node:crypto";
import { z } from "zod";
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

export interface BandHashInput {
  scenarioId: string;
  gains: GainCost[];
  costs: GainCost[];
  changeLines: string[];
  tone: string;
  customInstructions: string;
  sentenceBudget: number;
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
  for (const g of input.gains) h.update(`+${g.label}=${g.amount} `);
  for (const c of input.costs) h.update(`-${c.label}=${c.amount} `);
  for (const l of input.changeLines) h.update(`~${l} `);
  h.update(input.tone).update(" ");
  h.update(input.customInstructions).update(" ");
  h.update(String(input.sentenceBudget));
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
}

export function buildScenarioComparisonAiPrompt(
  args: ScenarioComparisonAiArgs,
): { system: string; user: string } {
  const systemParts = [
    "You write advisor commentary for a financial-planning report.",
    'Always sound warm, personable, and conversational — like you\'re talking with the household, not at them. Use "you" and "your". Skip corporate-speak and jargon.',
    `Address the household by first name where it sounds natural (${args.firstNames}). Once or twice across the whole response is plenty.`,
    "You are given several scenarios compared against the household's current plan (Base Case).",
    "Write ONE short paragraph per scenario explaining the TRADEOFF that scenario makes: what it buys, what it gives up, and briefly why — the mechanism, not just the direction.",
    "Where it sharpens the point, contrast one scenario against another by name. That contrast is the reason you see all of them at once.",
    "Only use numbers from the data below. Never invent figures.",
    "The gains and costs listed under each scenario are computed from the report's own table. Do not contradict them, and do not claim a gain or cost that is not listed.",
    "Attribute movement to a scenario's changes AS A SET. The data gives no per-change breakdown, so never assign a specific dollar or percentage figure to any single change.",
    "Format every dollar amount as $X.XM or $XXX K. Format percentages with at most one decimal place.",
    "Frame observations and risks. Do not give individualized advice or recommendations.",
    `Each paragraph must be at most ${args.sentenceBudget} sentences. Do not exceed this — the report has a fixed amount of room and longer text is cut.`,
    TONE[args.tone],
    "Return one entry per scenario, echoing the scenarioId you were given.",
  ];
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
    "",
    ...bandBlocks,
    "",
    "Write one paragraph per scenario now.",
  ].join("\n");

  return { system: systemParts.join(" "), user };
}
