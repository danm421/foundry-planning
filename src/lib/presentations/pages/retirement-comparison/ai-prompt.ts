// src/lib/presentations/pages/retirement-comparison/ai-prompt.ts
import { fmtUsdCompact as fmtUsd } from "./format";
import type { AfterTaxLegacy } from "./legacy";
import type { ComparisonKpi, PortfolioMatrix } from "./types";

const TONE: Record<"concise" | "detailed" | "plain", string> = {
  concise: "Lead with the single most important point. Trim every word you can.",
  detailed: "Bring in specific numbers where they sharpen the point. Don't pad.",
  plain: "Use everyday language. No jargon at all.",
};
const LENGTH: Record<"short" | "medium" | "long", string> = {
  short: "2-3 sentences total. One short paragraph.",
  medium: "4-6 sentences total. 1-2 short paragraphs.",
  long: "7-10 sentences total. 2-3 short paragraphs.",
};


export interface RetirementComparisonAiArgs {
  householdName: string;
  firstNames: string;
  scenarioLabel: string;
  kpis: ComparisonKpi[];
  matrix: PortfolioMatrix;
  changeLines: string[];
  tone: "concise" | "detailed" | "plain";
  length: "short" | "medium" | "long";
  customInstructions: string;
  maxSpend?: { base: number; scenario: number };
  downside?: { baseEndP20: number; scnEndP20: number };
  /** What each plan's heirs actually receive, and what the estate loses on the
   *  way. Distinct from the portfolio totals in `matrix` — see the system
   *  guardrail this adds. Omitted when the plan carries no estate model. */
  legacy?: { base: AfterTaxLegacy; scenario: AfterTaxLegacy };
}

export function buildRetirementComparisonAiPrompt(args: RetirementComparisonAiArgs): {
  system: string;
  user: string;
} {
  const systemParts = [
    "You write advisor commentary for a financial-planning report.",
    'Always sound warm, personable, and conversational — like you\'re talking with the household, not at them. Use "you" and "your". Skip corporate-speak and jargon.',
    `Address the household by first name where it sounds natural (${args.firstNames}). Don't overuse names; once or twice across the whole response is plenty.`,
    'Output: clean Markdown only. No preamble like "Here is your analysis" or headings unless asked for.',
    "Only use numbers from the data below. Never invent figures.",
    "Format every dollar amount as $X.XM or $XXX K or $X,XXX with commas. Never show raw decimals.",
    "Format percentages with at most one decimal place.",
    "Round numbers — the reader does not need cents.",
    "Focus on the impact on the household's total portfolio assets and on the plan confidence.",
    "Connect the scenario's changes to the results: tie the changes listed below to the movement in the KPIs and portfolio totals, and briefly explain the mechanism — why each change pushes the numbers the way it does (e.g., delaying retirement adds earning-and-growth years; a Roth conversion trades tax now for tax-free growth later).",
    "Reason qualitatively about cause and effect. The data gives only the combined Base→Scenario deltas, not a per-change breakdown, so attribute movement to the changes as a set and never assign a specific dollar or percentage figure to any single change.",
    "Frame observations and risks. Do not give individualized advice or recommendations.",
    "Keep paragraphs short (1-2 sentences). Favor brevity over completeness.",
    TONE[args.tone],
    `Length: ${LENGTH[args.length]} Do not exceed this.`,
  ];
  if (args.legacy) {
    // Without this, the model narrates the portfolio total as the inheritance
    // and reports a Roth conversion as destroying legacy — it is spending the
    // heirs' future tax bill, and the two numbers move in opposite directions.
    systemParts.push(
      "Two different quantities appear below and they are NOT interchangeable: the portfolio total at the end of life is what the plan holds BEFORE the estate settles, while what the heirs receive is that total after estate tax, probate and the income tax an heir owes on inherited pre-tax retirement accounts.",
      "When the two move in different directions, say so plainly and explain why: a plan holding more pre-tax money ends with a larger portfolio but hands its heirs less, because the tax on it is still owed. Prefer the amount the heirs receive when describing legacy, and name the portfolio total as the portfolio.",
    );
  }
  if (args.customInstructions.trim().length > 0) {
    systemParts.push(`Advisor instructions: ${args.customInstructions.trim()}`);
  }
  const system = systemParts.join(" ");

  const kpiLines = args.kpis
    .map((k) => `- ${k.label}: Base ${k.base} → Scenario ${k.scenario} (${k.deltaLabel}).`)
    .join("\n");
  const m = args.matrix;
  // Each side carries its own year: the two plans retire in different years, and
  // handing the model one year for both invited it to narrate a false like-for-like.
  const matrixLines = [
    `At retirement: Base ${fmtUsd(m.baseAtRetirement.total)} in ${m.baseRetirementYear} → Scenario ${fmtUsd(m.scenarioAtRetirement.total)} in ${m.scenarioRetirementYear}.`,
    `At end of life: Base ${fmtUsd(m.baseAtEnd.total)} in ${m.baseEndYear} → Scenario ${fmtUsd(m.scenarioAtEnd.total)} in ${m.scenarioEndYear}.`,
  ].join("\n");
  const changeBlock = args.changeLines.length
    ? args.changeLines.map((l) => `- ${l}`).join("\n")
    : "- (No changes vs. the base plan.)";

  const maxSpendBlock = args.maxSpend
    ? `Maximum sustainable retirement spending (today's dollars, same confidence target): Base ${fmtUsd(args.maxSpend.base)}/yr → Scenario ${fmtUsd(args.maxSpend.scenario)}/yr.`
    : null;
  const downsideBlock = args.downside
    ? `Downside (poor-market) ending balance — 20th percentile: Base ${fmtUsd(args.downside.baseEndP20)} → Scenario ${fmtUsd(args.downside.scnEndP20)}.`
    : null;

  // Gross → net on both sides, with the tax that separates them itemised, so
  // the commentary can attribute the gap instead of guessing at it.
  const legacySide = (label: string, endTotal: number, l: AfterTaxLegacy) =>
    `- ${label}: portfolio ${fmtUsd(endTotal)} at the end of life, of which ${fmtUsd(l.taxesAndCosts)} goes to estate tax, probate and income tax on inherited pre-tax accounts (${fmtUsd(l.ird)} of that is the income tax on inherited pre-tax accounts), leaving ${fmtUsd(l.toHeirs)} to the heirs.`;
  const legacyBlock = args.legacy
    ? [
        "What the heirs actually receive (after tax), vs. the portfolio total above:",
        legacySide("Base", m.baseAtEnd.total, args.legacy.base),
        legacySide("Scenario", m.scenarioAtEnd.total, args.legacy.scenario),
        `Change in what the heirs receive: ${
          args.legacy.scenario.toHeirs >= args.legacy.base.toHeirs ? "+" : "−"
        }${fmtUsd(Math.abs(args.legacy.scenario.toHeirs - args.legacy.base.toHeirs))}.`,
      ].join("\n")
    : null;

  const user = [
    `Household: ${args.householdName}.`,
    `Comparison: Base Case vs. "${args.scenarioLabel}".`,
    "",
    "Key metrics (Base → Scenario):",
    kpiLines,
    "",
    "Total portfolio assets:",
    matrixLines,
    ...(maxSpendBlock ? ["", maxSpendBlock] : []),
    ...(downsideBlock ? ["", downsideBlock] : []),
    ...(legacyBlock ? ["", legacyBlock] : []),
    "",
    "Changes made in the scenario vs. the base plan:",
    changeBlock,
    "",
    "Write the commentary now.",
  ].join("\n");

  return { system, user };
}
