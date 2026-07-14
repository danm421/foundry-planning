import type { DocumentType } from "./types";

interface ClassificationRule {
  type: DocumentType;
  keywords: string[];
  minMatches: number;
}

const RULES: ClassificationRule[] = [
  {
    type: "tax_return",
    keywords: ["form 1040", "adjusted gross", "taxable income", "schedule c", "schedule d", "w-2", "k-1", "1099"],
    minMatches: 1,
  },
  {
    type: "pay_stub",
    keywords: ["earnings statement", "pay stub", "gross pay", "net pay", "ytd", "pay period", "deductions", "federal withholding"],
    minMatches: 2,
  },
  {
    type: "insurance",
    keywords: ["policy", "premium", "coverage", "insured", "beneficiary", "declarations", "death benefit", "cash value"],
    minMatches: 2,
  },
  {
    type: "expense_worksheet",
    keywords: ["expense", "budget", "monthly", "annual spending", "groceries", "utilities", "housing cost", "spending plan"],
    minMatches: 2,
  },
  {
    type: "account_statement",
    keywords: ["statement", "account", "balance", "holdings", "portfolio", "shares", "market value", "positions"],
    minMatches: 2,
  },
];

/**
 * Vendor signatures for common financial-planning software. A match is a
 * high-precision signal that the document is a multi-section fact finder, so it
 * wins outright over the keyword rules below. Patterns are matched
 * case-insensitively against the document text AND the filename (advisors
 * routinely name files "Smith eMoney Fact Finder.pdf").
 *
 * Prefer long, software-distinctive strings. Short/ambiguous words are given
 * word boundaries (\b) so a stray occurrence in an unrelated document does not
 * trip detection. Add new software here as it shows up — this list is the only
 * thing that needs to change to recognize a new vendor.
 */
const FACT_FINDER_VENDOR_SIGNATURES: { vendor: string; patterns: RegExp[] }[] = [
  { vendor: "emoney", patterns: [/\bemoney\b/, /\bemx\b/, /emoney advisor/, /confidential client profile/] },
  { vendor: "moneyguide", patterns: [/moneyguidepro/, /\bmoneyguide\b/, /\bpietech\b/] },
  { vendor: "rightcapital", patterns: [/\brightcapital\b/] },
  { vendor: "naviplan", patterns: [/\bnaviplan\b/, /\badvicent\b/, /\bfiglo\b/] },
  { vendor: "asset-map", patterns: [/asset-?map/] },
  { vendor: "advisys", patterns: [/\badvisys\b/, /\badvizr\b/] },
  { vendor: "moneytree", patterns: [/\bmoneytree\b/] },
  { vendor: "generic", patterns: [/\bfact[\s-]?finder\b/, /financial planning questionnaire/, /client data summary/] },
];

/**
 * Distinct planning-entity categories used by the structural fact-finder
 * heuristic. A document that touches >= STRUCTURAL_MIN_CATEGORIES of these,
 * including at least one "planning-only" category (one a plain account statement
 * would never contain), is treated as a fact finder even when no vendor
 * signature matched — this is what catches unbranded / less-common / in-house
 * fact finders.
 */
const PLANNING_CATEGORY_KEYWORDS: { category: string; planningOnly: boolean; keywords: string[] }[] = [
  { category: "assets", planningOnly: false, keywords: ["account", "balance", "holdings", "portfolio", "brokerage", "401(k)", "market value"] },
  { category: "income", planningOnly: false, keywords: ["salary", "wages", "social security", "pension", "annual income", "earned income"] },
  { category: "expenses", planningOnly: true, keywords: ["living expenses", "monthly expenses", "budget", "discretionary spending", "annual spending"] },
  { category: "liabilities", planningOnly: false, keywords: ["mortgage", "loan balance", "credit card", "liability", "outstanding debt"] },
  { category: "insurance", planningOnly: true, keywords: ["life insurance", "death benefit", "policy", "premium", "coverage amount"] },
  { category: "estate", planningOnly: true, keywords: ["will", "revocable trust", "estate plan", "executor", "power of attorney", "beneficiary"] },
  { category: "goals", planningOnly: true, keywords: ["retirement goal", "financial goal", "objective", "retire at age", "target retirement"] },
  { category: "family", planningOnly: true, keywords: ["spouse", "dependent", "date of birth", "marital status", "household member", "children"] },
];

const STRUCTURAL_MIN_CATEGORIES = 4;

function matchFactFinderVendor(haystack: string): string | null {
  for (const { vendor, patterns } of FACT_FINDER_VENDOR_SIGNATURES) {
    if (patterns.some((re) => re.test(haystack))) return vendor;
  }
  return null;
}

function looksLikeFactFinderStructurally(lowerText: string): boolean {
  let count = 0;
  let hasPlanningOnly = false;
  for (const { planningOnly, keywords } of PLANNING_CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lowerText.includes(kw))) {
      count += 1;
      if (planningOnly) hasPlanningOnly = true;
    }
  }
  return count >= STRUCTURAL_MIN_CATEGORIES && hasPlanningOnly;
}

/**
 * Classify document text into a DocumentType using keyword heuristics.
 *
 * Fact-finder detection runs in two tiers before the single-type rules:
 *   1. A vendor signature (eMoney, MoneyGuidePro, RightCapital, …) matched
 *      against text + filename — an outright win.
 *   2. A structural check — >= 4 distinct planning categories including a
 *      planning-only one — which catches unbranded / less-common fact finders.
 * Structural detection defers to a strong single-purpose match (a Form 1040 tax
 * return, a pay stub) so those are never dragged into the slower multi-pass path.
 *
 * Returns "account_statement" as the default if nothing matches.
 */
export function classifyDocument(text: string, fileName?: string): DocumentType {
  const lower = text.toLowerCase();
  const haystack = `${lower}\n${(fileName ?? "").toLowerCase()}`;

  // Tier 1: vendor signature → fact_finder (highest precision).
  const vendor = matchFactFinderVendor(haystack);
  if (vendor) {
    console.log(`[classify] fact-finder vendor signature matched: ${vendor}`);
    return "fact_finder";
  }

  // Existing single-type keyword rules.
  let bestType: DocumentType = "account_statement";
  let bestScore = 0;
  for (const rule of RULES) {
    const matches = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matches >= rule.minMatches && matches > bestScore) {
      bestScore = matches;
      bestType = rule.type;
    }
  }

  // Tier 2: structural fact-finder. Defers to a strong single-purpose match —
  // a tax return or pay stub keeps its type.
  if (
    bestType !== "tax_return" &&
    bestType !== "pay_stub" &&
    looksLikeFactFinderStructurally(lower)
  ) {
    return "fact_finder";
  }

  return bestType;
}
