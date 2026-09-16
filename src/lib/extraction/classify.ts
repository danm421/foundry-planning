import type { DocumentType } from "./types";

interface ClassificationRule {
  type: DocumentType;
  keywords: string[];
  minMatches: number;
}

/**
 * Keywords match on WORD BOUNDARIES, never as bare substrings.
 *
 * A real ADP earnings statement scored the `account_statement` rule 4-3 over
 * `pay_stub` and was routed to the account-statement prompt, which invented a
 * $12,545 "Checking" account out of the year-to-date federal tax column. One of
 * those four hits was `shares` matching the client's SURNAME — "SHARESKY".
 *
 * Boundaries are lookarounds rather than `\b`, and each side is applied only
 * when the keyword's own edge is alphanumeric. A keyword already ending in
 * punctuation carries its own boundary: "401(k)" needs no trailing assertion,
 * and imposing one would stop it matching the ordinary plural "401(k)s".
 */
export function matchesKeyword(haystack: string, keyword: string): boolean {
  const body = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = /^[a-z0-9]/i.test(keyword) ? "(?<![a-z0-9])" : "";
  const suffix = /[a-z0-9]$/i.test(keyword) ? "(?![a-z0-9])" : "";
  return new RegExp(`${prefix}${body}${suffix}`, "i").test(haystack);
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
  { vendor: "emoney", patterns: [/\bemoney\b/, /emoney advisor/, /confidential client profile/] },
  { vendor: "moneyguide", patterns: [/moneyguidepro/, /\bmoneyguide\b/, /\bpietech\b/] },
  { vendor: "rightcapital", patterns: [/\brightcapital\b/] },
  { vendor: "naviplan", patterns: [/\bnaviplan\b/, /\badvicent\b/, /\bfiglo\b/] },
  { vendor: "asset-map", patterns: [/\basset-?map\b/] },
  { vendor: "advisys", patterns: [/\badvisys\b/, /\badvizr\b/] },
  { vendor: "moneytree", patterns: [/\bmoneytree\b/] },
  { vendor: "generic", patterns: [/\bfact[\s-]?finder\b/, /financial planning questionnaire/, /client data summary/] },
];

/**
 * Distinct planning-entity categories used by the structural fact-finder
 * heuristic. A document that touches >= STRUCTURAL_MIN_CATEGORIES of these,
 * including at least two "planning-only" categories (ones a plain account
 * statement would never contain), is treated as a fact finder even when no
 * vendor signature matched — this is what catches unbranded / less-common /
 * in-house fact finders.
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

/**
 * A payroll document is the one kind that must NEVER reach the account-statement
 * prompt: that prompt's whole job is to find a balance, and a stub is dense with
 * dollar figures that are not balances (a YTD tax column, a direct-deposit line,
 * a PTO hours balance). The pay-stub prompt has no `accounts` key at all, so
 * getting the TYPE right is the entire guard.
 *
 * Word boundaries alone leave the real ADP stub tied 3-3 with `account_statement`
 * and winning only on `RULES` array order. This tier makes it deliberate: a
 * payroll TITLE plus corroboration is an outright win, checked after the
 * fact-finder vendor signatures (a fact finder that asks the client to "attach
 * your most recent pay stub" stays a fact finder) and before the keyword rules.
 *
 * The corroboration requirement is what keeps the title patterns from firing on a
 * passing mention. Two of these terms together only co-occur on an actual stub.
 */
const PAYROLL_TITLE_PATTERNS: RegExp[] = [
  /earnings statement/,
  /statement of earnings/,
  /\bpay ?stub\b/,
  /\bpayslip\b/,
  /\bpay advice\b/,
  /payroll register/,
  /deposit advice/,
];

const PAYROLL_CORROBORATION = [
  "net pay",
  "gross pay",
  "net check",
  "pay date",
  "pay period",
  "period ending",
  "year to date",
  "ytd",
  "federal withholding",
  "social security tax",
];

const PAYROLL_MIN_CORROBORATION = 2;

function looksLikePayroll(lowerText: string): boolean {
  if (!PAYROLL_TITLE_PATTERNS.some((re) => re.test(lowerText))) return false;
  const corroborating = PAYROLL_CORROBORATION.filter((kw) =>
    matchesKeyword(lowerText, kw),
  ).length;
  return corroborating >= PAYROLL_MIN_CORROBORATION;
}

/**
 * The keyword rules can end in a TIE, and which type wins then is load-bearing:
 * the real ADP stub, stripped of its "Earnings Statement" title, scores
 * `pay_stub` 3 and `account_statement` 3.
 *
 * The two outcomes are not symmetric. The account-statement prompt's whole job
 * is to find a balance, so handed a payroll document it invents one; the
 * pay-stub prompt has no `accounts` key and cannot. A tie should therefore
 * resolve to the type that fails safe, which means most-specific first and
 * `account_statement` — the default — last.
 *
 * This used to fall out of `RULES` array order plus a strict `>`, so reordering
 * that array for readability would silently reopen the bug. Naming the order
 * here makes it a decision instead of an accident.
 */
const TIE_BREAK_ORDER: DocumentType[] = [
  "tax_return",
  "pay_stub",
  "insurance",
  "expense_worksheet",
  "account_statement",
];

function tieBreakRank(type: DocumentType): number {
  const index = TIE_BREAK_ORDER.indexOf(type);
  return index === -1 ? TIE_BREAK_ORDER.length : index;
}

const STRUCTURAL_MIN_CATEGORIES = 4;
const STRUCTURAL_MIN_PLANNING_ONLY = 2;

function matchFactFinderVendor(haystack: string): string | null {
  for (const { vendor, patterns } of FACT_FINDER_VENDOR_SIGNATURES) {
    if (patterns.some((re) => re.test(haystack))) return vendor;
  }
  return null;
}

function looksLikeFactFinderStructurally(lowerText: string): boolean {
  let count = 0;
  let planningOnlyCount = 0;
  for (const { planningOnly, keywords } of PLANNING_CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => matchesKeyword(lowerText, kw))) {
      count += 1;
      if (planningOnly) planningOnlyCount += 1;
    }
  }
  return count >= STRUCTURAL_MIN_CATEGORIES && planningOnlyCount >= STRUCTURAL_MIN_PLANNING_ONLY;
}

/**
 * Classify document text into a DocumentType using keyword heuristics.
 *
 * Fact-finder detection runs in two tiers before the single-type rules:
 *   1. A vendor signature (eMoney, MoneyGuidePro, RightCapital, …) matched
 *      against text + filename — an outright win.
 *   2. A structural check — >= 4 distinct planning categories including at
 *      least two planning-only ones — which catches unbranded / less-common
 *      fact finders.
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

  // Tier 1b: a payroll document, which must never reach the account-statement
  // prompt. Runs after the vendor signatures so a fact finder that merely asks
  // for a pay stub keeps its own type.
  if (looksLikePayroll(lower)) {
    console.log("[classify] payroll signature matched");
    return "pay_stub";
  }

  // Existing single-type keyword rules.
  let bestType: DocumentType = "account_statement";
  let bestScore = 0;
  for (const rule of RULES) {
    const matches = rule.keywords.filter((kw) => matchesKeyword(lower, kw)).length;
    if (matches < rule.minMatches) continue;
    const wins =
      matches > bestScore ||
      (matches === bestScore && tieBreakRank(rule.type) < tieBreakRank(bestType));
    if (wins) {
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
