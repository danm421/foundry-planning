// Data-independent BY CONTRACT: `document.tsx` calls this as
// `estimatePageCount(undefined, options)` while it plans the deck's layout, so
// it may only read options. One sheet per printed section — the renderer emits
// exactly one `PageFrame` each — floored at one, because an all-off report
// still prints the empty-state sheet.
import { printedSections, type InvestmentProposalOptions } from "./options-schema";

export function estimateInvestmentProposalPageCount(
  _data: unknown,
  options: InvestmentProposalOptions,
): number {
  return Math.max(1, printedSections(options).length);
}
