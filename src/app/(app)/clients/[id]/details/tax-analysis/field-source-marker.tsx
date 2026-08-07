"use client";

import type { DocumentSummary } from "@/lib/tax-returns/assemble-analysis";
import type { FieldConflict } from "@/lib/tax-returns/merge/types";
import { fmtUsd } from "@/lib/tax-analysis/format";

function docLabel(documents: DocumentSummary[], id: string): string {
  return documents.find((d) => d.id === id)?.filename ?? "another document";
}

function fmt(value: unknown): string {
  return typeof value === "number" ? fmtUsd(value) : String(value ?? "—");
}

/**
 * Provenance renders LIGHTLY on purpose. Marking every field would be noise —
 * on a normal return almost everything comes from the 1040. Two cases earn ink:
 * a value that came from somewhere other than the primary return, and a genuine
 * CONFLICT, which is the one case the advisor must adjudicate rather than
 * merely notice.
 */
export function FieldSourceMarker({
  path,
  provenance,
  conflicts,
  documents,
}: {
  path: string;
  provenance: Record<string, string>;
  conflicts: FieldConflict[];
  documents: DocumentSummary[];
}) {
  const sourceId = provenance[path];

  // `deriveProvenance` rewrites an overridden path to "advisor" regardless of
  // whether the merge had flagged it as a conflict — `assembleFacts` returns
  // `conflicts` unfiltered, so the conflict entry survives the override that
  // resolved it. Checking this FIRST, ahead of the conflict lookup, is what
  // suppresses both branches: an advisor override means the input already
  // holds the advisor's value, so neither the conflict banner (which would
  // misreport what's in use) nor the "from a supporting document" dot (the
  // existing advisor-suppression rule this extends) should render.
  if (sourceId === "advisor") return null;

  const conflict = conflicts.find((c) => c.path === path);
  if (conflict) {
    return (
      <span className="mt-1 block text-xs text-crit">
        {docLabel(documents, conflict.winner.documentId)} says {fmt(conflict.winner.value)};{" "}
        {conflict.losers
          .map((l) => `${docLabel(documents, l.documentId)} says ${fmt(l.value)}`)
          .join("; ")}
        . Using the first — edit the field to override.
      </span>
    );
  }

  if (!sourceId) return null;
  const source = documents.find((d) => d.id === sourceId);
  if (!source || source.role === "full_return") return null;

  return (
    <span
      className="ml-1 inline-block align-middle text-[10px] text-ink-3"
      title={`From ${source.filename ?? "a supporting document"}`}
      aria-label={`From ${source.filename ?? "a supporting document"}`}
    >
      ●
    </span>
  );
}
