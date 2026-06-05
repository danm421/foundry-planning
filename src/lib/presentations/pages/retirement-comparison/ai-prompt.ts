// src/lib/presentations/pages/retirement-comparison/ai-prompt.ts
import { fmtUsdCompact as fmtUsd } from "./format";
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
    "Focus on the impact on the household's total portfolio assets and on the probability of success.",
    "Connect the scenario's changes to the results: tie the changes listed below to the movement in the KPIs and portfolio totals, and briefly explain the mechanism — why each change pushes the numbers the way it does (e.g., delaying retirement adds earning-and-growth years; a Roth conversion trades tax now for tax-free growth later).",
    "Reason qualitatively about cause and effect. The data gives only the combined Base→Scenario deltas, not a per-change breakdown, so attribute movement to the changes as a set and never assign a specific dollar or percentage figure to any single change.",
    "Frame observations and risks. Do not give individualized advice or recommendations.",
    "Keep paragraphs short (1-2 sentences). Favor brevity over completeness.",
    TONE[args.tone],
    `Length: ${LENGTH[args.length]} Do not exceed this.`,
  ];
  if (args.customInstructions.trim().length > 0) {
    systemParts.push(`Advisor instructions: ${args.customInstructions.trim()}`);
  }
  const system = systemParts.join(" ");

  const kpiLines = args.kpis
    .map((k) => `- ${k.label}: Base ${k.base} → Scenario ${k.scenario} (${k.deltaLabel}).`)
    .join("\n");
  const m = args.matrix;
  const matrixLines = [
    `At retirement (${m.retirementYear}): Base ${fmtUsd(m.baseAtRetirement.total)} → Scenario ${fmtUsd(m.scenarioAtRetirement.total)}.`,
    `At end of life (${m.endOfLifeYear}): Base ${fmtUsd(m.baseAtEnd.total)} → Scenario ${fmtUsd(m.scenarioAtEnd.total)}.`,
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
    "",
    "Changes made in the scenario vs. the base plan:",
    changeBlock,
    "",
    "Write the commentary now.",
  ].join("\n");

  return { system, user };
}
