"use client";

import { useState } from "react";
import { ExportModal } from "./export-modal";

export function ExportButton({ reportId }: { reportId: string }) {
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
      />
    </>
  );
}
