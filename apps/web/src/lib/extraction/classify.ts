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
 * Classify document text into a DocumentType using keyword heuristics.
 * Returns "account_statement" as the default if no strong match is found.
 */
export function classifyDocument(text: string): DocumentType {
  const lower = text.toLowerCase();

  let bestType: DocumentType = "account_statement";
  let bestScore = 0;

  for (const rule of RULES) {
    const matches = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matches >= rule.minMatches && matches > bestScore) {
      bestScore = matches;
      bestType = rule.type;
    }
  }

  return bestType;
}
