// Ready-made observations whose every figure is a merge token, so a stored
// copy stays current as the plan changes. Framework-free, beside the token
// registry it depends on. The "Insert a fact" menu on the report's options
// panel is the only consumer; a test pins every token here to PLAN_TOKENS.
import type { ObservationTopic } from "@/lib/schemas/observations";
import { renderTokens } from "./tokens";

export interface ObservationLibraryEntry {
  id: string;
  /** The menu row. Says so when the figure needs another page in the deck. */
  label: string;
  topic: ObservationTopic;
  /** Markdown made only of registry tokens and plain words. */
  body: string;
}

export const OBSERVATION_LIBRARY: ObservationLibraryEntry[] = [
  {
    id: "savings-where-it-goes",
    label: "Savings & where it goes",
    topic: "cash-flow",
    body: "You're saving {{annual_savings}} a year — {{savings_by_account}} — about {{savings_rate}} of your salary.",
  },
  {
    id: "employer-contributions",
    label: "Employer contributions",
    topic: "cash-flow",
    body: "On top of that, your employer adds {{employer_contributions}} a year to your retirement accounts.",
  },
  {
    id: "income-vs-spending",
    label: "Income vs. spending",
    topic: "cash-flow",
    body: "This year you'll bring in {{annual_income}} and spend {{annual_spending}}, leaving {{annual_surplus}} after savings and taxes.",
  },
  {
    id: "net-worth",
    label: "Net worth",
    topic: "general",
    body: "Your net worth today is {{net_worth}}, with {{total_liabilities}} of debt outstanding.",
  },
  {
    id: "investable-assets",
    label: "Investable assets",
    topic: "investments",
    body: "You have {{portfolio_assets}} in investable assets today.",
  },
  {
    id: "retirement-timing",
    label: "Retirement timing",
    topic: "retirement",
    body: "You plan to retire at {{client_retirement_age}}, in {{retirement_year}} — {{years_to_retirement}} from now.",
  },
  {
    id: "spouse-retirement-timing",
    label: "Spouse retirement timing",
    topic: "retirement",
    body: "{{spouse_first_name}} plans to retire at {{spouse_retirement_age}}.",
  },
  {
    id: "plan-confidence",
    label: "Plan confidence (needs a Monte Carlo page in the deck)",
    topic: "retirement",
    body: "Your plan succeeds in {{mc_success}} of the market scenarios we tested.",
  },
  {
    id: "debt",
    label: "Debt",
    topic: "cash-flow",
    body: "You carry {{total_liabilities}} in debt today; the largest is {{largest_liability}}.",
  },
  {
    id: "effective-tax-rate",
    label: "Effective tax rate",
    topic: "tax",
    body: "Roughly {{effective_tax_rate}} of your income will go to taxes this year.",
  },
  {
    id: "estate-exposure",
    label: "Estate exposure",
    topic: "estate",
    body: "At the plan's horizon your estate would owe an estimated {{estate_tax_at_horizon}} in estate tax.",
  },
];

const TOKEN_PATTERN = /\{\{([a-z0-9_]+)\}\}/g;

export function tokensIn(body: string): string[] {
  return [...body.matchAll(TOKEN_PATTERN)].map((m) => m[1]);
}

/**
 * The entries the menu offers. An entry whose preview would still hold an
 * unresolved token is hidden — a solo household never sees the spouse entry, a
 * plan with no debt never sees the debt entry. A map that has not loaded
 * (`null`) shows everything: the previews then read "…" rather than the menu
 * going empty on a slow or failed token-values load.
 */
export function visibleLibraryEntries(
  values: Record<string, string | null> | null,
): ObservationLibraryEntry[] {
  if (values === null) return OBSERVATION_LIBRARY;
  return OBSERVATION_LIBRARY.filter((entry) =>
    tokensIn(entry.body).every((id) => values[id] != null),
  );
}

/** The resolved sentence for the menu row, or the body with "…" per token
 *  while values are still loading — the same convention the Details panel
 *  uses for a row body. */
export function previewLibraryEntry(
  entry: ObservationLibraryEntry,
  values: Record<string, string | null> | null,
): string {
  if (values === null) return entry.body.replace(TOKEN_PATTERN, "…");
  return renderTokens(entry.body, values);
}
