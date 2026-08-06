"use client";

import {
  IntakeUploadZone,
  SampleUploadZone,
  type IntakeUploadContext,
} from "@/components/intake/intake-upload-zone";
import type { IntakeDocumentView } from "@/lib/intake/document-types";

export interface DocumentsStepProps {
  uploads: IntakeUploadContext;
}

/**
 * One illustrative row for the advisor's preview, so the sample shows the list
 * state and not only an empty drop target. Named for what it is: nobody
 * uploaded this, and no advisor should read it as a file a client sent.
 */
const SAMPLE_DOCUMENTS: IntakeDocumentView[] = [
  {
    id: "sample-tax-return",
    filename: "example-tax-return.pdf",
    docType: "tax_return",
    sizeBytes: 428_000,
    uploadedAt: "2026-01-01T00:00:00.000Z",
  },
];

// ─── DocumentsStep ───────────────────────────────────────────────────────────
//
// The catch-all step: anything the client wants their advisor to have that the
// earlier steps didn't ask for. The type picker is on, and the list shows
// everything uploaded anywhere in the wizard — a client who attached a pay stub
// back on the Income step should see it here rather than wonder if it landed.

export function DocumentsStep({ uploads }: DocumentsStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-ink-2">
        Anything else that would help — tax returns, wills and trusts, insurance
        policies. Your advisor is the only person who sees these.
      </p>

      {uploads.kind === "sample" ? (
        <SampleUploadZone
          docType="other"
          allowTypeChoice
          documents={SAMPLE_DOCUMENTS}
          label="Add a document"
        />
      ) : (
        <IntakeUploadZone
          token={uploads.token}
          docType="other"
          allowTypeChoice
          documents={uploads.documents}
          onChanged={uploads.onChanged}
          label="Add a document"
        />
      )}
    </div>
  );
}
