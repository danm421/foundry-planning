import type { AssumptionsPageData } from "./types";
import type { AssumptionsPageOptions } from "./options-schema";

// Overview is 1 page. The account table adds ~1 page per 30 rows. The appendix
// (portfolios + CMA) is a further page when enabled.
export function estimateAssumptionsPageCount(
  data: AssumptionsPageData,
  options: AssumptionsPageOptions,
): number {
  let pages = 1;
  if (options.includeAccountTable && data.accounts && data.accounts.length > 0) {
    pages += Math.max(1, Math.ceil(data.accounts.length / 30));
  }
  if (options.includeCmaAppendix && (data.cma != null || data.referencedPortfolios != null)) {
    pages += 1;
  }
  return pages;
}
