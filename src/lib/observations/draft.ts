// AI-draft generation for the "Observations & Next Steps" section. Builds a
// grounded fact sheet from the same TokenContext the merge-token registry
// resolves against (src/lib/plan-text/tokens.ts), then asks the model to
// draft observations/next-steps referencing merge tokens instead of raw
// numbers wherever one exists — so the client-facing text stays current as
// the plan changes. Mirrors the structured-output pattern in
// src/lib/crm/meeting-prep/generate.ts (chatModel + withStructuredOutput).
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "@/domain/forge/llm";
import { exactCurrency } from "@/lib/presentations/format";
import { PLAN_TOKENS, resolveAllTokens, type TokenContext } from "@/lib/plan-text/tokens";
import { OBSERVATION_TOPICS } from "@/lib/schemas/observations";

export const ObservationSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        section: z.enum(["observation", "next_step"]),
        topic: z.enum(OBSERVATION_TOPICS),
        title: z.string().nullable(),
        body: z.string().min(1),
        owner: z.enum(["advisor", "client", "joint"]).nullable(),
        priority: z.enum(["high", "medium", "low"]).nullable(),
      }),
    )
    .min(1)
    .max(16),
});
export type ObservationSuggestions = z.infer<typeof ObservationSuggestionSchema>;

const SYSTEM_PROMPT = `You are a financial planning analyst drafting the "Observations & Next Steps"
section of a client-facing financial plan. Use ONLY the facts provided — never
invent numbers or products. Write in plain, warm, professional language a
client can read. No performance guarantees, no product recommendations, no
"you must" — frame next steps as recommended actions.
Produce 4–8 observations (statements of fact/finding, grouped by topic) and
3–7 next steps (specific actions with an owner). Wherever a figure has a merge
token in the cheat-sheet, write the token (e.g. {{net_worth}}) instead of the
number so the text stays current.`;

/** `resolveAllTokens` returns null for anything unresolved — never fabricate
 *  a number in its place. */
function fig(value: string | null): string {
  return value ?? "not computed";
}

/**
 * Build the human-message fact sheet: resolved plan figures (each tagged with
 * its merge-token id when one exists) followed by the full token cheat-sheet,
 * so the model can substitute `{{token}}` for any figure it references.
 */
export function buildObservationsFacts(ctx: TokenContext): string {
  const { clientData, projection, monteCarlo } = ctx;
  const { client } = clientData;
  const values = resolveAllTokens(ctx);
  const firstYear = projection.years[0];
  const lastYear = projection.years.at(-1);

  const lines: string[] = [];

  lines.push(`Household: ${fig(values.household_names)} (token {{household_names}})`);

  lines.push(
    `Client: age ${firstYear.ages.client}, retirement age ${client.retirementAge} (token {{client_retirement_age}})`,
  );
  if (client.spouseName) {
    const spouseAge = firstYear.ages.spouse != null ? String(firstYear.ages.spouse) : "not computed";
    lines.push(
      `Spouse: age ${spouseAge}, retirement age ${fig(values.spouse_retirement_age)} (token {{spouse_retirement_age}})`,
    );
  }

  lines.push(
    `Filing status: ${client.filingStatus}; residence state: ${clientData.planSettings.residenceState ?? "not set"}`,
  );

  lines.push(`Year-1 annual income: ${fig(values.annual_income)} (token {{annual_income}})`);
  lines.push(`Year-1 annual spending: ${fig(values.annual_spending)} (token {{annual_spending}})`);
  lines.push(`Year-1 annual savings: ${fig(values.annual_savings)} (token {{annual_savings}})`);

  lines.push(`Portfolio assets (today): ${fig(values.portfolio_assets)} (token {{portfolio_assets}})`);
  lines.push(`Net worth (today): ${fig(values.net_worth)} (token {{net_worth}})`);
  lines.push(`Total liabilities (today): ${fig(values.total_liabilities)} (token {{total_liabilities}})`);

  lines.push(
    `Monte Carlo success rate: ${monteCarlo ? fig(values.mc_success) : "not computed"} (token {{mc_success}})`,
  );

  const horizonYear = lastYear ? String(lastYear.year) : "not computed";
  lines.push(
    `Estate tax at plan horizon (${horizonYear}): ${fig(values.estate_tax_at_horizon)} (token {{estate_tax_at_horizon}})`,
  );

  if (clientData.liabilities.length > 0) {
    lines.push("Liabilities:");
    for (const l of clientData.liabilities) {
      lines.push(`  - ${l.name}: ${exactCurrency(l.balance)}`);
    }
  }

  const educationGoals = clientData.expenses.filter((e) => e.type === "education");
  if (educationGoals.length > 0) {
    lines.push("Education goals:");
    for (const g of educationGoals) {
      lines.push(`  - ${g.name}: ${exactCurrency(g.annualAmount)}/yr, ${g.startYear}–${g.endYear}`);
    }
  }

  const cheatSheet = PLAN_TOKENS.map((t) => `{{${t.id}}} — ${t.label}`).join("\n");

  return [
    "FACT SHEET",
    ...lines,
    "",
    "MERGE TOKEN CHEAT-SHEET — write the token instead of the number for any figure listed here, so the text stays current when the plan changes:",
    cheatSheet,
  ].join("\n");
}

/**
 * Draft observations + next steps from a fact sheet. Structured-output call
 * against the "full" (reasoning) deployment — mirrors
 * generateMeetingPrepDraft (src/lib/crm/meeting-prep/generate.ts).
 */
export async function generateObservationsDraft(facts: string): Promise<ObservationSuggestions> {
  const result = await chatModel("full")
    .withStructuredOutput(ObservationSuggestionSchema)
    .invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(facts)]);
  return result as ObservationSuggestions;
}
