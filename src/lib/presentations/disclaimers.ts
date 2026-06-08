/**
 * Disclaimer / disclosure copy for client presentation print-outs.
 *
 * SINGLE SOURCE OF TRUTH — edit copy here, not inside layout components.
 *
 * NOTE: This is general financial-planning boilerplate, NOT a
 * compliance-reviewed disclosure. Firm-specific regulatory language
 * (ADV / registration disclosure, custodian / SIPC notes, etc.) must be
 * added by whoever owns compliance.
 */

/** One-line disclaimer repeated on every content page footer. */
export const SHORT_DISCLAIMER =
  "For illustrative and discussion purposes only — hypothetical projections, not a guarantee of future results.";

/** Heading shown above the long disclosure block on the TOC page. */
export const DISCLOSURES_HEADING = "Important Disclosures";

export interface LongDisclaimerArgs {
  firmName: string;
  clientName: string;
  reportDate: string;
}

/** Long disclosure block, as an array of paragraphs, for the TOC page. */
export function longDisclaimerParagraphs({
  firmName,
  clientName,
  reportDate,
}: LongDisclaimerArgs): string[] {
  return [
    `This presentation was prepared by ${firmName} for ${clientName} and is intended solely for informational and discussion purposes as of ${reportDate}. It is not an offer or solicitation to buy or sell any security, nor is it personalized legal, tax, accounting, or investment advice.`,
    "The analyses and projections shown are hypothetical and illustrative. They rely on assumptions — including rates of return, inflation, tax rates, spending, and life expectancy — provided by or developed together with you. These assumptions will not occur exactly as shown; actual results will differ, and the differences may be material.",
    "Hypothetical projections are not a guarantee or prediction of actual investment results. Investing involves risk, including possible loss of principal, and past performance is not indicative of future results. Where probability-based (Monte Carlo) analysis is shown, results are based on simulated scenarios and assumptions and do not guarantee any outcome.",
    "Tax and estate figures are estimates based on current law, which is subject to change. Please consult your attorney, accountant, or tax advisor before acting on any information in this report.",
  ];
}
