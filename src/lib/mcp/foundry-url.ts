/**
 * Pages an MCP response can point an advisor at. Read-only tools answer with
 * the numbers plus a link, so "what if John retires at 62" gets a real next
 * step instead of a refusal.
 */
export type FoundryPage =
  | "overview"
  | "balanceSheet"
  | "netWorth"
  | "scenarios"
  | "cashflow"
  | "monteCarlo"
  | "tax"
  | "estate"
  | "insurance"
  | "family"
  | "incomeExpenses"
  | "assumptions"
  | "presentations";

const PAGE_PATHS: Record<FoundryPage, string> = {
  overview: "overview",
  balanceSheet: "assets/balance-sheet-report",
  netWorth: "details/net-worth",
  scenarios: "solver",
  cashflow: "cashflow",
  monteCarlo: "cashflow/monte-carlo",
  tax: "details/tax-analysis",
  estate: "estate-planning/estate-flow",
  insurance: "details/insurance",
  family: "details/family",
  incomeExpenses: "details/income-expenses",
  assumptions: "details/assumptions",
  presentations: "presentations",
};

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

/** Absolute deep link to one of a household's pages in Foundry. */
export function foundryUrl(clientId: string, page: FoundryPage): string {
  return `${appOrigin()}/clients/${clientId}/${PAGE_PATHS[page]}`;
}

/**
 * Absolute deep link to a CRM household's Notes tab. Separate from
 * `foundryUrl` on purpose: that one builds `/clients/{clientId}/...`, and a
 * prospect household has no planning client to put in that path.
 */
export function foundryCrmNotesUrl(householdId: string): string {
  return `${appOrigin()}/crm/households/${householdId}?tab=notes`;
}

/** Absolute link that opens the Solver on one scenario (the page reads `?scenario=`). */
export function foundryScenarioUrl(clientId: string, scenarioId: string): string {
  return `${foundryUrl(clientId, "scenarios")}?scenario=${encodeURIComponent(scenarioId)}`;
}

/**
 * Absolute link to a document in a CRM household's vault — the route that
 * streams it. It opens only for someone signed in to Foundry with access to
 * that household; there are no public or signed links.
 */
export function foundryDocumentUrl(householdId: string, documentId: string): string {
  return `${appOrigin()}/api/crm/households/${householdId}/documents/${documentId}`;
}
