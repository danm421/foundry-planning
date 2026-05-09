"use client";

import { useState } from "react";
import { ExportModal } from "./export-modal";

interface Props {
  reportId: string;
  // Per-export option overrides merged into the artifact's defaultOptions
  // before the request is sent. Used by report views (e.g. Investments'
  // include-out-of-estate toggle) to pass UI state through to the PDF.
  optsOverride?: Record<string, unknown>;
}

export function ExportButton({ reportId, optsOverride }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-deep"
      >
        Export
      </button>
      <ExportModal
        reportId={reportId}
        open={open}
        onOpenChange={setOpen}
        optsOverride={optsOverride}
      />
    </>
  );
}
