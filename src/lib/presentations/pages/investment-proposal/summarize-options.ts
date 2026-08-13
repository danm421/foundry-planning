import { printedSections, type InvestmentProposalOptions } from "./options-schema";

/** The launcher row's one-liner. Names the unpicked state explicitly — a deck
 *  with no proposal picked prints an empty state, and the advisor should see
 *  that in the row rather than discover it in the PDF. */
export function summarizeInvestmentProposalOptions(o: InvestmentProposalOptions): string {
  const picked = o.proposalId === "" ? "no proposal picked" : "1 proposal";
  return `${picked} · ${printedSections(o).length} sections`;
}
