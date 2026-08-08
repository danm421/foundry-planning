import type { Finding, FindingCategory, FindingSeverity } from "../types";

/**
 * The presentation vocabulary shared by the report view and the PDF — the
 * severity grouping, the category chip labels, and the sort. Both renderers
 * used to keep their own copy of the group list (tax-report-view.tsx and
 * tax-analysis-pdf-document.tsx each had one); this is the single copy.
 */

/** Severity IS the advisor's triage order (spec D17), so the group order and
 *  the sort's rank both derive from this one list. */
export const SEVERITY_GROUPS: Array<{ severity: FindingSeverity; heading: string }> = [
  { severity: "opportunity", heading: "Opportunities" },
  { severity: "watch", heading: "Watch items" },
  { severity: "info", heading: "Notes" },
];

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  brackets: "Brackets",
  retirement: "Retirement",
  business: "Business",
  "real-estate": "Real estate",
  investments: "Investments",
  credits: "Credits",
  withholding: "Withholding",
  state: "State",
  deductions: "Deductions",
};

const RANK: Record<FindingSeverity, number> = { opportunity: 0, watch: 1, info: 2 };

/**
 * Severity group order, then estimatedImpact descending, nulls last (spec D17).
 * Stable by construction: the original index breaks every tie, so two findings
 * of equal impact never swap between renders — and the returned array is a new
 * one, because the caller's `analysis.findings` is shared with the PDF.
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const bySeverity = RANK[a.f.severity] - RANK[b.f.severity];
      if (bySeverity !== 0) return bySeverity;
      const ai = a.f.estimatedImpact;
      const bi = b.f.estimatedImpact;
      if (ai == null && bi == null) return a.i - b.i;
      if (ai == null) return 1;
      if (bi == null) return -1;
      if (bi !== ai) return bi - ai;
      return a.i - b.i;
    })
    .map((x) => x.f);
}
