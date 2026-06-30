// src/domain/forge/help/catalog.ts
//
// Curated product-help catalog. SINGLE SOURCE OF TRUTH for what global Forge
// can tell an advisor about using the app: how-to steps, the deep-link to the
// right page, and (Plan 3) the id of a guided walkthrough. The model never
// supplies a URL — it picks a topic id and the server resolves the href here.
// Every href MUST start with an allowlisted prefix (asserted in tests).

export type HelpTopic = {
  /** Stable id the model references (e.g. "add-household"). */
  id: string;
  /** Human title shown in answers + the prompt index. */
  title: string;
  /** Lowercase match terms for search_help. */
  keywords: string[];
  /** Plain-language steps — the chat answer body. */
  steps: string[];
  /** Deep-link to where the task is performed. Allowlisted prefix. */
  href: string;
  /** Plan 3: id of a guided walkthrough for this task, if one exists. */
  walkthroughId?: string;
};

/** Prefixes every topic href must start with. Mirrors the navigable surface of
 *  the advisor app; kept in sync with NAVIGATE_ALLOWLIST_PREFIXES (custom-events). */
export const HELP_HREF_ALLOWLIST_PREFIXES = [
  "/clients",
  "/crm",
  "/cma",
  "/tasks",
  "/data-collection",
  "/settings",
] as const;

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "add-household",
    title: "Add a new client or household",
    keywords: ["add", "new", "create", "household", "client", "prospect"],
    steps: [
      "From the Clients list, click New household (top-right).",
      "Enter the household name and the residence state.",
      "Add the primary contact's first and last name.",
      "Click Save. The household opens — from there you can set up the financial plan.",
    ],
    href: "/crm/new",
  },
  {
    id: "set-up-plan",
    title: "Set up a financial plan for a household",
    keywords: ["plan", "planning", "set up", "projection", "client", "onboard"],
    steps: [
      "Open the household, then start a new plan from the Clients > New client flow.",
      "Provide the primary contact's date of birth, retirement age, life expectancy, and filing status.",
      "Save to create the base-case plan; the projection and reports populate from there.",
    ],
    href: "/clients/new",
  },
  {
    id: "import-document",
    title: "Import a document (statement, fact-finder)",
    keywords: ["import", "upload", "document", "statement", "extract", "pdf", "fact finder"],
    steps: [
      "Open the client, go to Details > Import.",
      "Upload the PDF or document; Forge extracts accounts, income, and family data.",
      "Review the extracted entities and apply them to the plan.",
    ],
    href: "/clients",
  },
  {
    id: "run-monte-carlo",
    title: "Run a Monte Carlo simulation",
    keywords: ["monte carlo", "simulation", "probability", "success", "risk"],
    steps: [
      "Open the client and go to Cash Flow > Monte Carlo.",
      "The simulation runs against the active scenario and reports the success probability.",
    ],
    href: "/clients",
  },
  {
    id: "build-scenario",
    title: "Build a what-if scenario",
    keywords: ["scenario", "what if", "solver", "compare", "strategy"],
    steps: [
      "Open the client and go to the Solver.",
      "Add techniques or adjust assumptions, then compare against the base case.",
    ],
    href: "/clients",
  },
  {
    id: "generate-report",
    title: "Generate a presentation / report",
    keywords: ["report", "presentation", "deck", "pdf", "print", "client report"],
    steps: [
      "Open the client and go to Reports / Presentations.",
      "Choose a template and generate; the deck renders in the background.",
    ],
    href: "/clients",
  },
  {
    id: "manage-tasks",
    title: "Manage CRM tasks",
    keywords: ["task", "tasks", "to-do", "follow up", "crm"],
    steps: [
      "Open Tasks from the sidebar to see all open items across households.",
      "Create, assign, and complete tasks there, or per-client from the client's CRM tab.",
    ],
    href: "/tasks",
  },
  {
    id: "data-collection",
    title: "Send a data-collection form to a client",
    keywords: ["data collection", "form", "intake", "questionnaire", "collect"],
    steps: [
      "Open Data Collection from the sidebar.",
      "Create a collection flow and share the link with the client.",
    ],
    href: "/data-collection",
  },
  {
    id: "find-settings",
    title: "Find firm and account settings",
    keywords: ["settings", "billing", "firm", "account", "profile", "subscription"],
    steps: ["Open Settings from the bottom of the sidebar."],
    href: "/settings",
  },
  {
    id: "open-cma",
    title: "Open Capital Market Assumptions (CMA)",
    keywords: ["cma", "capital market", "assumptions", "returns", "asset class"],
    steps: ["Open CMAs from the sidebar to review and edit return/risk assumptions."],
    href: "/cma",
  },
];

const norm = (s: string) => s.toLowerCase();

/** Keyword/title search, ranked by match count, max 5. */
export function findHelpTopics(query: string): HelpTopic[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const scored = HELP_TOPICS.map((t) => {
    const hay = norm(`${t.title} ${t.keywords.join(" ")}`);
    const score = terms.reduce((n, term) => (hay.includes(term) ? n + 1 : n), 0);
    return { t, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((x) => x.t);
}

export function getHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

/** Compact `id — title` list injected into the global system prompt so the
 *  model knows what topics exist and calls get_help/search_help for detail. */
export function helpTopicIndex(): string {
  return HELP_TOPICS.map((t) => `${t.id} — ${t.title}`).join("\n");
}
