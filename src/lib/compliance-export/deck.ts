import type { ExportPdfBody } from "@/components/presentations/render-presentation-pdf";

export const COMPLIANCE_RUN_KIND = "compliance_export";
export const COMPLIANCE_REPORT_TYPE = "compliance_export";

/** ISO date (YYYY-MM-DD) in UTC — deterministic, matches the run's calendar day. */
function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The fixed compliance deck: Client Profile + Balance Sheet, base-case, as-of
 * today. `year` is only consulted in `eoy` mode (we use `today`) but the page's
 * zod schema requires it, so we pass the current calendar year.
 */
export function buildCompliancePages(now: Date): ExportPdfBody["pages"] {
  return [
    { pageId: "clientProfile", options: {} },
    {
      pageId: "balanceSheet",
      options: { asOf: "today", year: now.getUTCFullYear(), includeOutOfEstate: false },
    },
  ];
}

export function complianceFilename(now: Date): string {
  return `${isoDate(now)} Compliance Snapshot - Profile + Balance Sheet.pdf`;
}

export function buildComplianceRequestPayload(scenarioId: string, now: Date): ExportPdfBody {
  return {
    scenarioId,
    filename: complianceFilename(now),
    preview: false,
    pages: buildCompliancePages(now),
  };
}
