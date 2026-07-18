// src/lib/insights/prompt.ts
import type { InsightsBattery } from "./battery";
import type { GeneratedInsights } from "./generate";
import type { PersonRetirementFacts } from "@/lib/retirement/retirement-facts";

const pct = (x: number | null): string => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const usd = (x: number): string => `$${Math.round(x).toLocaleString("en-US")}`;

/**
 * One line per person: the age they retire and the calendar year it happens.
 * Without these the model only saw "years to retirement" and had nothing to
 * check advisor notes against — it once merged a discovery note ("retire around
 * Cooper's 60th birthday") into a plan that models retirement at 65.
 */
function retirementLines(people: PersonRetirementFacts[]): string[] {
  if (people.length === 0) return ["- (no retirement age on file)"];
  return people.map((p) => {
    const now = p.currentAge != null ? `now ${p.currentAge}` : "current age unknown";
    const when = p.retirementYear != null ? ` in ${p.retirementYear}` : "";
    return `- ${p.label} (${now}) retires at age ${p.retirementAge}${when}`;
  });
}

export function buildInsightsPrompt(b: InsightsBattery): { system: string; user: string } {
  const system =
    "You are a financial-planning analyst writing a concise 360 profile for an " +
    "advisor. Use ONLY the figures provided. Do not invent numbers, accounts, or " +
    "facts. Be specific and factual. Output EXACTLY three markdown sections with " +
    "these headers, in this order: `## SNAPSHOT`, `## GOALS`, `## OPPORTUNITIES`. " +
    "SNAPSHOT is 2-4 sentences (who they are, life stage, what matters). GOALS is " +
    "a short bulleted list. OPPORTUNITIES is a bulleted list of advisor next-steps, " +
    "each grounded in a figure above. When risk is over_risked or goals_over_reaching, " +
    "reflect any stated behavioral note (e.g. sells in downturns) as a caveat.\n\n" +
    "SOURCE PRECEDENCE — this is strict. The KPI and PLAN sections are the modeled " +
    "plan and are authoritative. Advisor notes are free-text meeting records: they " +
    "capture what clients SAID, may be months out of date, and may contradict the " +
    "plan. Never restate a retirement age, retirement year, age, date, or dollar " +
    "figure taken from a note as if it were the plan. State timing using the PLAN " +
    "retirement ages and years verbatim. If a note conflicts with a plan figure, do " +
    "NOT blend or average them — keep the plan figure and raise the conflict as an " +
    "OPPORTUNITIES item for the advisor to reconcile (e.g. a stated wish to retire " +
    "earlier than the age the plan models).";

  const user = [
    `Client: ${b.clientName}`,
    ``,
    `KPIs:`,
    `- Net worth: ${usd(b.kpis.netWorth)}`,
    `- Liquid portfolio: ${usd(b.kpis.liquidPortfolio)}`,
    `- Years until the first retirement: ${b.kpis.yearsToRetirement ?? "n/a"}`,
    `- Monte Carlo success: ${pct(b.kpis.mcSuccessRate)}`,
    `- Funding score: ${b.kpis.fundingScore.toFixed(2)} (1.0 = fully funded)`,
    ``,
    `PLAN retirement timing (authoritative — use these ages and years exactly):`,
    ...retirementLines(b.retirementPeople),
    ``,
    `Risk (growth-exposure %, 0=all cash, 100=all equity):`,
    `- Current allocation: ${b.risk.currentPct}`,
    `- Required to hit goals: ${b.risk.requiredPct}`,
    `- Capacity supports up to: ${b.risk.capacityPct}`,
    `- Verdict: ${b.risk.verdict}`,
    ``,
    `Advisor goal notes: ${b.grounding.goalsText || "(none recorded)"}`,
    `Recent advisor notes: ${b.grounding.notesText || "(none recorded)"}`,
    ``,
    `Write the SNAPSHOT, GOALS, and OPPORTUNITIES sections now.`,
  ].join("\n");

  return { system, user };
}

/** Split the model's headered markdown into the three sections. */
export function parseInsightSections(markdown: string): GeneratedInsights {
  const grab = (header: string): string => {
    const re = new RegExp(`##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    return markdown.match(re)?.[1]?.trim() ?? "";
  };
  const snapshot = grab("SNAPSHOT");
  const goals = grab("GOALS");
  const opportunities = grab("OPPORTUNITIES");
  if (!snapshot && !goals && !opportunities) {
    return { snapshot: markdown.trim(), goals: "", opportunities: "" };
  }
  return { snapshot, goals, opportunities };
}
