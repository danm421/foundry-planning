"use client";

import { useRef, useState } from "react";
import type { DocumentSummary } from "@/lib/tax-returns/assemble-analysis";

const ROLE_LABELS: Record<DocumentSummary["role"], string> = {
  full_return: "Form 1040",
  k1: "Schedule K-1",
  w2: "Form W-2",
  other: "Other",
};

// Deliberately shorter than ROLE_LABELS: Testing Library's getByText also
// matches <option> text, so an identical "Form 1040" / "Schedule K-1" label
// here would collide with a document row showing the same role and make
// getByText throw on multiple matches.
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "full_return", label: "1040" },
  { value: "k1", label: "K-1" },
  { value: "w2", label: "W-2" },
  { value: "other", label: "Other type" },
];

export function DocumentsStrip({
  documents,
  unavailable,
  busy,
  onAdd,
  onRemove,
}: {
  documents: DocumentSummary[];
  unavailable: boolean;
  busy: boolean;
  onAdd: (file: File, role: string) => void;
  onRemove: (documentId: string) => void;
}) {
  const [role, setRole] = useState("auto");
  const fileRef = useRef<HTMLInputElement>(null);

  if (unavailable) {
    return (
      <div className="rounded border border-hair bg-card p-3 text-sm text-ink-3">
        The document list is not available yet — it needs a database update that hasn&apos;t
        been applied. The figures below are unaffected.
      </div>
    );
  }

  return (
    <div className="rounded border border-hair bg-card">
      <div className="flex items-center gap-2 border-b border-hair px-3 py-2">
        <h3 className="text-sm font-medium text-ink">Documents</h3>
        <span className="text-xs text-ink-3">
          {documents.length === 1 ? "1 document" : `${documents.length} documents`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="add-document-role">
            Document type
          </label>
          <select
            id="add-document-role"
            className="rounded border border-hair bg-card px-2 py-1 text-xs text-ink-2"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary h-8 px-3 text-xs font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Add document
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAdd(file, role);
          e.target.value = "";
        }}
      />

      {documents.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-3">
          No documents yet. Add the Form 1040, then any K-1s and W-2s — they merge into one year.
        </p>
      ) : (
        <ul>
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 border-b border-hair px-3 py-2 last:border-b-0"
            >
              <span className="w-[7.5rem] shrink-0 text-xs font-medium text-ink-2">
                {ROLE_LABELS[doc.role]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {doc.filename ?? "Untitled"}
              </span>
              <span className="shrink-0 text-xs text-ink-3">
                {new Date(doc.createdAt).toLocaleDateString()}
              </span>
              {doc.warnings.length > 0 && (
                <span className="shrink-0 text-xs text-warn">
                  {doc.warnings.length === 1 ? "1 warning" : `${doc.warnings.length} warnings`}
                </span>
              )}
              <button
                type="button"
                className="ml-auto shrink-0 text-xs text-ink-3 underline hover:text-crit disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${doc.filename ?? "this document"}? The year's figures will be recalculated from what's left.`,
                    )
                  ) {
                    onRemove(doc.id);
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
