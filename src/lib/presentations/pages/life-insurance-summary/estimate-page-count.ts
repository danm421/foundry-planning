// src/lib/presentations/pages/life-insurance-summary/estimate-page-count.ts
// Data-independent: document.tsx calls this during layout planning without the
// loaded inventory, so it can't know the policy count. Fixed at 2; a very long
// policy list auto-paginates (table/beneficiaries are wrap-enabled) and may push
// TOC numbers by one — an accepted v1 limitation (see spec).
export function estimateLifeInsuranceSummaryPageCount(): number {
  return 2;
}
