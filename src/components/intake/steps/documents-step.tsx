"use client";

import {
  IntakeUploadZone,
  type IntakeUploadContext,
} from "@/components/intake/intake-upload-zone";

export interface DocumentsStepProps {
  uploads: IntakeUploadContext;
}

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

      <IntakeUploadZone
        token={uploads.token}
        docType="other"
        allowTypeChoice
        documents={uploads.documents}
        onChanged={uploads.onChanged}
        label="Add a document"
      />
    </div>
  );
}
