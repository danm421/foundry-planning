"use client";

import DialogShell from "@/components/dialog-shell";

interface SourceDocViewerProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  importId: string;
  fileId: string;
  fileName?: string;
  /** Optional [start, end] page range from row provenance — first page focused. */
  pageRange?: [number, number];
}

export default function SourceDocViewer({
  open,
  onClose,
  clientId,
  importId,
  fileId,
  fileName,
  pageRange,
}: SourceDocViewerProps) {
  // The browser PDF viewer reads `#page=N` to scroll to the page.
  // Other fragment params (zoom, view) are intentionally omitted —
  // advisors can adjust those in the viewer UI themselves.
  const focusPage = pageRange?.[0];
  const src = `/api/clients/${clientId}/imports/${importId}/files/${fileId}${
    focusPage ? `#page=${focusPage}` : ""
  }`;

  return (
    <DialogShell
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={fileName ?? "Source document"}
      size="xl"
    >
      <div className="h-[75vh] w-full overflow-hidden rounded border border-hair bg-card-2">
        <iframe
          src={src}
          title={fileName ?? "Source document"}
          className="h-full w-full"
        />
      </div>
    </DialogShell>
  );
}
