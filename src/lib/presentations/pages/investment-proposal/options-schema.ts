// The Investment Proposal page's options — and the ONE place the report's
// section list is decided. `printedSections` is that place; three things must
// agree with it: `estimateInvestmentProposalPageCount` (which `document.tsx`
// calls with NO data to number every page in the deck), the launcher summary,
// and the renderer. Keeping the count and the render behind one function is
// what stops the deck mis-numbering every page after this one.
//
// Zod 4: declare defaults with `.default(...)` ALONE. `.optional().default(...)`
// wraps the default in an optional and the field stops defaulting.
import { z } from "zod";

/** Print order. The array order IS the document order — §11 "Sections, in print order". */
export const SECTION_IDS = [
  "verdict",
  "allocation",
  "riskReturn",
  "suitability",
  "growth",
  "stress",
  "outcomes",
  "fees",
  "transition",
  "commentary",
  "holdings",
] as const;

export type ProposalSectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Record<ProposalSectionId, string> = {
  verdict: "The recommendation",
  allocation: "Allocation",
  riskReturn: "Risk & return",
  suitability: "Suitability",
  growth: "Growth of $100,000",
  stress: "Stress test",
  outcomes: "Range of outcomes",
  fees: "Fees",
  transition: "Transition & tax",
  commentary: "Commentary",
  holdings: "Holdings & disclosures",
};

const sectionsShape = Object.fromEntries(
  SECTION_IDS.map((id) => [id, z.boolean().default(true)]),
) as Record<ProposalSectionId, z.ZodDefault<z.ZodBoolean>>;

const ALL_ON = Object.fromEntries(SECTION_IDS.map((id) => [id, true])) as Record<
  ProposalSectionId,
  boolean
>;

export const investmentProposalOptionsSchema = z.object({
  /** Empty until the advisor picks one. An empty id renders the empty state. */
  proposalId: z.string().default(""),
  sections: z.object(sectionsShape).default(ALL_ON),
  tone: z.enum(["concise", "detailed", "plain"]).default("plain"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  /** Filled by the AI generator; the advisor may hand-edit it afterwards. */
  ai: z
    .object({
      generatedText: z.string().default(""),
      generatedAt: z.string().default(""),
      sourceHash: z.string().default(""),
      customInstructions: z.string().max(2000).default(""),
    })
    .default({ generatedText: "", generatedAt: "", sourceHash: "", customInstructions: "" }),
});

export type InvestmentProposalOptions = z.infer<typeof investmentProposalOptionsSchema>;

export const INVESTMENT_PROPOSAL_OPTIONS_DEFAULT: InvestmentProposalOptions = {
  proposalId: "",
  sections: { ...ALL_ON },
  tone: "plain",
  length: "medium",
  ai: { generatedText: "", generatedAt: "", sourceHash: "", customInstructions: "" },
};

/**
 * The sections this report will PRINT, in document order.
 *
 * Deliberately the only definition. The page count and the renderer both call
 * it, so they cannot drift — the drift is what mis-numbers a deck.
 */
export function printedSections(options: InvestmentProposalOptions): ProposalSectionId[] {
  return SECTION_IDS.filter((id) => options.sections[id]);
}
