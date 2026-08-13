// Pure prompt builder for the Investment Proposal page's commentary. Pure so it
// can be unit-tested against a fixture snapshot without an Azure call, and so
// the prompt hash — the Redis cache key — is a function of the frozen snapshot
// and the advisor's settings alone.
//
// The prompt writes to a CLIENT, not an advisor. Two rules are load-bearing
// rather than stylistic: it may not promise an outcome, and it must name the
// tax cost and the break-even. A commentary that lists only the benefits is the
// one that gets an advisor in trouble.
import type { ProposalSnapshot } from "@/lib/investments/proposals/types";

export interface InvestmentProposalAiArgs {
  firstNames: string;
  proposalName: string;
  targetLabel: string;
  snapshot: ProposalSnapshot;
  tone: "concise" | "detailed" | "plain";
  length: "short" | "medium" | "long";
  customInstructions: string;
}

const TONE: Record<InvestmentProposalAiArgs["tone"], string> = {
  concise: "Tone: brisk and factual. Short sentences.",
  detailed: "Tone: thorough. Explain the mechanism behind each number.",
  plain: "Tone: plain and warm. Assume no financial background. Define any term you must use.",
};

const LENGTH: Record<InvestmentProposalAiArgs["length"], string> = {
  short: "Two short paragraphs.",
  medium: "Three to four short paragraphs.",
  long: "Five to six short paragraphs.",
};

const usd = (v: number | null) => {
  if (v === null) return "unknown";
  const n = Math.round(v);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
};
const pct2 = (v: number | null) => (v === null ? "unknown" : `${(v * 100).toFixed(2)}%`);
const pct1 = (v: number | null) => (v === null ? "unknown" : `${(v * 100).toFixed(1)}%`);

function breakEvenLine(s: ProposalSnapshot): string {
  const be = s.breakEven;
  switch (be.verdict) {
    case "recovered":
      return `Break-even: about ${be.years!.toFixed(1)} years.`;
    case "beyond_horizon":
      return "Break-even: not within the horizon shown.";
    case "no_benefit":
      return "Break-even: none — the proposal is not expected to out-earn the current portfolio after fees.";
    case "no_tax_cost":
      return "Break-even: immediate — there is no tax cost to switch.";
  }
}

export function buildInvestmentProposalAiPrompt(args: InvestmentProposalAiArgs): {
  system: string;
  user: string;
} {
  const s = args.snapshot;
  const cur = s.compute.current;
  const prop = s.compute.proposed;

  const system = [
    "You write the commentary a financial advisor hands to a client alongside an investment proposal.",
    `Write to the household by first name where it sounds natural (${args.firstNames}). Once or twice across the whole response is plenty.`,
    'Output: clean Markdown only. No preamble like "Here is your analysis" and no headings unless asked.',
    "Only use numbers from the data below. Never invent figures.",
    "Format every dollar amount with commas and no cents. Format percentages with at most two decimals.",
    "Never promise or guarantee an outcome. Expected returns are assumptions, not forecasts.",
    "You MUST name the tax cost of switching and the break-even. Do not describe the benefits without them.",
    "Do not give individualized advice. Describe what the proposal does and what it costs.",
    "Keep paragraphs short (1-2 sentences). Plain words over jargon; gloss any term you must use.",
    TONE[args.tone],
    `Length: ${LENGTH[args.length]} Do not exceed this.`,
  ].join("\n");

  const lines = [
    `Proposal: ${args.proposalName} (target: ${args.targetLabel})`,
    "",
    `Portfolio value: ${usd(cur.totalValue)}`,
    `Expected return: ${pct1(cur.cma.geometricReturn)} now, ${pct1(prop.cma.geometricReturn)} proposed`,
    `Volatility: ${pct1(cur.cma.stdDev)} now, ${pct1(prop.cma.stdDev)} proposed`,
    `Blended fund cost: ${pct2(s.fees.currentBlendedEr)} now, ${pct2(s.fees.proposedBlendedEr)} proposed`,
    `All-in cost per year: ${usd(s.fees.annualDollarsCurrent)} now, ${usd(s.fees.annualDollarsProposed)} proposed`,
    `Estimated tax to switch: ${usd(s.compute.tax.estimatedTax)} on ${usd(s.compute.tax.realizedGain)} of realized gain.`,
    breakEvenLine(s),
    "",
    "Allocation change, by asset class:",
    ...s.compute.assetMixDelta.map((d) => `  ${d.name}: ${pct1(d.currentPct)} → ${pct1(d.targetPct)}`),
    "",
    "Suitability:",
    `  Documented profile: ${s.suitability.clientLevel ?? "none on file"}`,
    `  Current holdings place as: ${s.suitability.currentPlacement?.level ?? "unknown"}`,
    `  Proposed portfolio places as: ${s.suitability.proposedPlacement?.level ?? "unknown"}`,
    `  Proposal matches the documented rung: ${s.suitability.proposedMatchesProfile ? "yes" : "no"}`,
  ];

  const available = s.stress.filter((w) => w.available);
  if (available.length > 0) {
    lines.push("", "How each portfolio behaved in past declines:");
    for (const w of available) {
      lines.push(`  ${w.label}: ${pct1(w.currentReturn)} now vs ${pct1(w.proposedReturn)} proposed`);
    }
  }

  if (args.customInstructions.trim().length > 0) {
    lines.push("", "Advisor instructions:", args.customInstructions.trim());
  }

  return { system, user: lines.join("\n") };
}
