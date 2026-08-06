/**
 * Client-safe intake document taxonomy.
 *
 * Split out of `documents.ts` for the same reason `crm/document-constants.ts`
 * is split out of `crm/documents.ts`: that module imports `@/db`,
 * `@vercel/blob` and the Clerk-backed audit log, none of which can enter a
 * client bundle — and the wizard's doc-type picker is a client component.
 * `documents.ts` re-exports everything here, so server code can keep importing
 * from the one module it always did.
 */

/** Single source of truth for the intake doc-type picker and the POST route's
 *  allowlist. Do not fork a second literal list — see the Task 5 review. */
export const INTAKE_DOC_TYPES = [
  "statement",
  "paystub",
  "mortgage",
  "tax_return",
  "estate",
  "insurance",
  "other",
] as const;

export type IntakeDocType = (typeof INTAKE_DOC_TYPES)[number];

/** What the client sees in the picker and beside each uploaded file. */
export const INTAKE_DOC_TYPE_LABELS: Record<IntakeDocType, string> = {
  statement: "Account statement",
  paystub: "Pay stub",
  mortgage: "Mortgage statement",
  tax_return: "Tax return",
  estate: "Will or trust",
  insurance: "Insurance policy",
  other: "Something else",
};

/** Human label for a stored type. `description` on the document row is a free
 *  text column, so an unrecognised value yields null and the caller shows
 *  nothing rather than a raw enum string. Used by both the client's upload
 *  zone and the advisor's review panel. */
export function intakeDocTypeLabel(docType: string | null | undefined): string | null {
  if (!docType) return null;
  return INTAKE_DOC_TYPE_LABELS[docType as IntakeDocType] ?? null;
}

/** What the client is allowed to see: names, never locations. */
export interface IntakeDocumentView {
  id: string;
  filename: string;
  docType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}
