"use client";

import { createContext, useContext } from "react";
import type { Provenance } from "@/lib/imports/types";

/**
 * Maps an uploaded import file's id → its original filename. Provided once
 * by the review wizard so each row's SourceBadge can name the document its
 * data was extracted from, without prop-drilling the map through every step.
 */
export const SourceFilesContext = createContext<Record<string, string>>({});

/** Format a provenance page range as a " · p. 3" / " · pp. 8–10" suffix. */
function formatPages(pageRange?: [number, number]): string {
  if (!pageRange) return "";
  const [start, end] = pageRange;
  return start === end ? ` · p. ${start}` : ` · pp. ${start}–${end}`;
}

interface SourceBadgeProps {
  /**
   * The extracted row. It carries `__provenance` at runtime even though its
   * static type (e.g. `ExtractedAccount`) doesn't declare it.
   */
  row: unknown;
  /** Extra classes for alignment with the row's action cluster. */
  className?: string;
}

/**
 * Small document icon whose native tooltip names the source document an
 * extracted asset came from. Renders nothing for rows without provenance
 * (e.g. rows the advisor added by hand).
 */
export default function SourceBadge({ row, className = "" }: SourceBadgeProps) {
  const fileNames = useContext(SourceFilesContext);
  const provenance = (row as { __provenance?: Provenance }).__provenance;
  if (!provenance) return null;

  const name = fileNames[provenance.sourceFileId] ?? "source document";
  const title = `From ${name}${formatPages(provenance.pageRange)}`;

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex shrink-0 items-center text-ink-4 ${className}`}
    >
      <DocIcon />
    </span>
  );
}

function DocIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
