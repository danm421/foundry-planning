// Data-independent BY CONTRACT: `document.tsx` calls this as
// `estimatePageCount(undefined, options)` while it plans the deck's layout, so
// it may only read options. The number it returns is what the deck's table of
// contents numbers every LATER page from, so it must equal the number of
// `PageFrame`s the renderer actually emits — for every options value, including
// the ones where no proposal is picked.
//
// Two cases, both decidable from options alone:
//  · No proposal picked (`proposalId === ""`). The renderer prints ONE
//    empty-state sheet, so reserve one. Reserving eleven here is the bug that
//    shipped on Plan Story: eleven sheets booked, one printed, and a contents
//    page pointing ten sheets past every section after it.
//  · A proposal picked. One sheet per printed section — the renderer emits
//    exactly one `PageFrame` each, and it does so even when the proposal turns
//    out to have been deleted (each sheet then carries the "no longer
//    available" message), so the count holds whether or not the load found it.
import { printedSections, type InvestmentProposalOptions } from "./options-schema";

export function estimateInvestmentProposalPageCount(
  _data: unknown,
  options: InvestmentProposalOptions,
): number {
  if (options.proposalId === "") return 1;
  return Math.max(1, printedSections(options).length);
}
