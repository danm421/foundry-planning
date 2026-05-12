import type { ResolvedSource } from "./ai-source-resolve";
import type { AiTone, AiLength } from "./layout-schema";

const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  concise: "Lead with the single most important point. Trim every word you can.",
  detailed: "Bring in specific numbers where they sharpen the point. Don't pad.",
  plain: "Use everyday language. No jargon at all.",
};

const LENGTH_HINTS: Record<AiLength, string> = {
  short: "2-3 sentences total. One short paragraph.",
  medium: "4-6 sentences total. 1-2 short paragraphs.",
  long: "7-10 sentences total. 2-3 short paragraphs.",
};

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

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

export interface HouseholdContext {
  clientFirstName: string;
  clientLastName: string;
  clientCurrentAge: number | undefined;
  clientRetirementAge: number;
  clientRetirementYear: number | undefined;
  planEndAge: number;
  spouse?: {
    firstName: string;
    currentAge: number | undefined;
    retirementAge: number | undefined;
    retirementYear: number | undefined;
  };
  filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
  inflationRate: number;
  residenceState: string | null;
  planStartYear: number;
  planEndYear: number;
}

export interface BuildPromptInput {
  sources: ResolvedSource[];
  plans: AiPlanYearly[];
  tone: AiTone;
  length: AiLength;
  customInstructions: string;
  household: HouseholdContext;
}

function formatFilingStatus(s: HouseholdContext["filingStatus"]): string {
  switch (s) {
    case "married_joint": return "married filing jointly";
    case "married_separate": return "married filing separately";
    case "head_of_household": return "head of household";
    case "single": return "single";
  }
}

function householdDisplayName(h: HouseholdContext): string {
  const parts: string[] = [];
  if (h.spouse) parts.push(`${h.clientFirstName} & ${h.spouse.firstName}`);
  else parts.push(h.clientFirstName);
  if (h.clientLastName) parts.push(h.clientLastName);
  return parts.join(" ").trim() || "the household";
}

function formatHouseholdContextBlock(h: HouseholdContext): string {
  const lines: string[] = [];
  const clientAge = h.clientCurrentAge != null ? `, currently age ${h.clientCurrentAge}` : "";
  const clientRet =
    h.clientRetirementYear != null
      ? `retires at age ${h.clientRetirementAge} (${h.clientRetirementYear})`
      : `retires at age ${h.clientRetirementAge}`;
  lines.push(`- ${h.clientFirstName}${clientAge}; ${clientRet}.`);
  if (h.spouse) {
    const sAge = h.spouse.currentAge != null ? `, currently age ${h.spouse.currentAge}` : "";
    let sRet = "";
    if (h.spouse.retirementAge != null && h.spouse.retirementYear != null) {
      sRet = `retires at age ${h.spouse.retirementAge} (${h.spouse.retirementYear})`;
    } else if (h.spouse.retirementAge != null) {
      sRet = `retires at age ${h.spouse.retirementAge}`;
    } else {
      sRet = "retirement age unknown";
    }
    lines.push(`- ${h.spouse.firstName}${sAge}; ${sRet}.`);
  }
  lines.push(`- Filing status: ${formatFilingStatus(h.filingStatus)}.`);
  lines.push(`- Inflation assumption: ${(h.inflationRate * 100).toFixed(1)}%.`);
  if (h.residenceState) lines.push(`- Residence state: ${h.residenceState}.`);
  lines.push(`- Plan horizon: ${h.planStartYear}–${h.planEndYear} (through age ${h.planEndAge}).`);
  return lines.join("\n");
}

export function buildComparisonAiPrompt(input: BuildPromptInput): { system: string; user: string } {
  const { sources, plans, tone, length, customInstructions, household } = input;
  const householdName = householdDisplayName(household);
  const householdBlock = formatHouseholdContextBlock(household);

  const firstNames = household.spouse
    ? `${household.clientFirstName} and ${household.spouse.firstName}`
    : household.clientFirstName;

  const systemParts = [
    "You write advisor commentary for a financial-planning report.",
    "Always sound warm, personable, and conversational — like you're talking with the household, not at them. Use \"you\" and \"your\". Skip corporate-speak and jargon.",
    `Address the household by first name where it sounds natural (${firstNames}). Don't overuse names; once or twice across the whole response is plenty.`,
    "Output: clean Markdown only. No preamble like \"Here is your analysis\" or headings unless asked for.",
    "Only use numbers from the data below. Never invent figures.",
    "Format every dollar amount as $X.XM (e.g. $3.7M) or $XXX K (e.g. $474K) or $X,XXX with commas. Never show raw decimals like 3664560.69.",
    "Format percentages with at most one decimal place (e.g. 5.2%).",
    "Round numbers — the reader does not need cents.",
    "Frame observations and risks. Do not give individualized advice or recommendations.",
    "Keep paragraphs short (1-2 sentences). Favor brevity over completeness.",
    "Tie the analysis back to the widgets listed below.",
    TONE_INSTRUCTIONS[tone],
    `Length: ${LENGTH_HINTS[length]} Do not exceed this.`,
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
        `  ${y.year} (age ${y.age}): income ${formatMoney(y.income)}, expenses ${formatMoney(y.expenses)}, taxes ${formatMoney(y.taxes)}, end balance ${formatMoney(y.endBalance)}`,
    );
    planBlocks.push([`Plan: ${p.label} (id=${p.planId})`, ...rows].join("\n"));
  }

  const user = [
    `Household: ${householdName}.`,
    "",
    "About the household:",
    householdBlock,
    "",
    "Widgets the advisor is comparing:",
    widgetLines.length > 0 ? widgetLines.join("\n") : "  (none selected)",
    "",
    "Yearly projection data (already rounded — use these formatted figures verbatim, do not re-precision them):",
    planBlocks.length > 0 ? planBlocks.join("\n\n") : "(no plans referenced)",
    "",
    "Write the commentary now.",
  ].join("\n");

  return { system, user };
}
