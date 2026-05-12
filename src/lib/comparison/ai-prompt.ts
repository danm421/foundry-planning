import type { ResolvedSource } from "./ai-source-resolve";
import type { AiTone, AiLength } from "./layout-schema";

const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  concise: "Be concise and direct. Lead with the main point.",
  detailed: "Be detailed. Include specific numbers and short explanations.",
  plain: "Use plain English. Avoid jargon. Address the household directly.",
};

const LENGTH_HINTS: Record<AiLength, string> = {
  short: "1-2 short paragraphs.",
  medium: "3-4 short paragraphs.",
  long: "5-6 short paragraphs.",
};

export interface AiPlanYearly {
  planId: string;
  label: string;
  years: Array<{
    year: number;
    age: number;
    income: number;
    expenses: number;
    taxes: number;
    endBalance: number;
  }>;
}

export interface BuildPromptInput {
  sources: ResolvedSource[];
  plans: AiPlanYearly[];
  tone: AiTone;
  length: AiLength;
  customInstructions: string;
  householdName: string;
}

export function buildComparisonAiPrompt(input: BuildPromptInput): { system: string; user: string } {
  const { sources, plans, tone, length, customInstructions, householdName } = input;

  const systemParts = [
    "You are a financial-planning assistant generating advisor-facing commentary inside a side-by-side scenario comparison tool.",
    "Output: clean Markdown only. No preamble like 'Here is your analysis'.",
    "Only use numbers that appear in the data below. Do not invent figures.",
    "Frame observations and risks; do not give individualized advice or recommendations.",
    "Keep paragraphs short (2-4 sentences each).",
    "Tie the analysis back to the widgets the advisor is comparing, listed in the user message.",
    TONE_INSTRUCTIONS[tone],
    LENGTH_HINTS[length],
  ];
  if (customInstructions.trim().length > 0) {
    systemParts.push(`Advisor instructions: ${customInstructions.trim()}`);
  }
  const system = systemParts.join(" ");

  const planIdsReferenced = new Set<string>();
  const widgetLines: string[] = [];
  for (const s of sources) {
    for (const pid of s.planIds) planIdsReferenced.add(pid);
    const yr = s.yearRange ? `, years ${s.yearRange.start}-${s.yearRange.end}` : "";
    const planList = s.planIds.length > 0 ? `, plans: ${s.planIds.join(", ")}` : "";
    widgetLines.push(`- ${s.widgetKind} (${s.groupTitle || "Untitled group"})${yr}${planList}`);
  }

  const planRangeByPlan = new Map<string, { start: number; end: number } | null>();
  for (const s of sources) {
    if (!s.yearRange) {
      for (const pid of s.planIds) planRangeByPlan.set(pid, null); // null = full range
      continue;
    }
    for (const pid of s.planIds) {
      const cur = planRangeByPlan.has(pid) ? planRangeByPlan.get(pid)! : undefined;
      if (cur === null) continue; // already full
      if (!cur) {
        planRangeByPlan.set(pid, { start: s.yearRange.start, end: s.yearRange.end });
      } else {
        planRangeByPlan.set(pid, {
          start: Math.min(cur.start, s.yearRange.start),
          end: Math.max(cur.end, s.yearRange.end),
        });
      }
    }
  }

  const planBlocks: string[] = [];
  for (const p of plans) {
    if (!planIdsReferenced.has(p.planId)) continue;
    const range = planRangeByPlan.get(p.planId);
    const filtered = range
      ? p.years.filter((y) => y.year >= range.start && y.year <= range.end)
      : p.years;
    const rows = filtered.map(
      (y) =>
        `  ${y.year} age=${y.age} income=${y.income} expenses=${y.expenses} taxes=${y.taxes} endBalance=${y.endBalance}`,
    );
    planBlocks.push([`Plan: ${p.label} (id=${p.planId})`, ...rows].join("\n"));
  }

  const user = [
    `Household: ${householdName}.`,
    "",
    "Widgets the advisor is comparing:",
    widgetLines.length > 0 ? widgetLines.join("\n") : "  (none selected)",
    "",
    "Yearly projection data:",
    planBlocks.length > 0 ? planBlocks.join("\n\n") : "(no plans referenced)",
    "",
    "Write the commentary now.",
  ].join("\n");

  return { system, user };
}
