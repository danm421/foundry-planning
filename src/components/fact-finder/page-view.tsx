"use client";
// src/components/fact-finder/page-view.tsx
// One fact finder page: each of its sections as an editable card, then the
// Removed tray for that page's sections. Edits go through `onApply`
// (useFactFinder's apply) as ops.
import { Card } from "@/components/card";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { ClientOp } from "@/lib/fact-finder/ops";
import { findSection, sectionsOnPage, type FFPage, type FFSection } from "@/lib/fact-finder/schema";
import { changedCellsOf } from "@/lib/fact-finder/screen-summary";
import type { FactFinderState, FFRow } from "@/lib/fact-finder/types";
import { PlusIcon } from "./icons";
import { RemovedTray } from "./removed-tray";
import { SectionBody } from "./section-tables";

export interface PageViewProps {
  page: FFPage;
  state: FactFinderState;
  /** `useFactFinder`'s `apply`: false when the edit was refused. */
  onApply: (ops: ClientOp[]) => boolean;
  /** Uploaded file id → its name; undefined once the file is gone. */
  fileName: (fileId: string) => string | undefined;
}

interface SectionCardProps extends Omit<PageViewProps, "page" | "state"> {
  section: FFSection;
  rows: FFRow[];
  changed: ReadonlySet<string>;
}

function SectionCard({ section, rows, changed, onApply, fileName }: SectionCardProps) {
  const headingId = `fact-finder-section-${section.id}`;
  const canAdd = section.layout === "list" || section.layout === "transposed";
  // An empty list folds to its header; fixed rows and notes always show.
  const folded = canAdd && rows.length === 0;
  return (
    <Card aria-labelledby={headingId}>
      <div className={`flex items-center gap-1.5 px-[var(--pad-card)] py-3 ${folded ? "" : "border-b border-hair"}`}>
        <h3 id={headingId} className="text-sm font-semibold text-ink-2">
          {section.label}
        </h3>
        {section.hint && <FieldTooltip text={section.hint} side="bottom" />}
        {canAdd && (
          <button
            type="button"
            aria-label={`Add row to ${section.label}`}
            // The hook doesn't mint ids: the row's id is chosen here, so later
            // edits to the new row name the same id on the client and server.
            onClick={() => onApply([{ op: "addRow", sectionId: section.id, rowId: crypto.randomUUID() }])}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add row
          </button>
        )}
      </div>
      {!folded && (
        <SectionBody
          section={section}
          rows={rows}
          changed={changed}
          onApply={onApply}
          fileName={fileName}
          labelledBy={headingId}
        />
      )}
    </Card>
  );
}

export function PageView({ page, state, onApply, fileName }: PageViewProps) {
  const changed = changedCellsOf(state);
  const removed = state.removed.flatMap((entry) => {
    const section = findSection(entry.sectionId);
    return section?.page === page ? [{ entry, section }] : [];
  });
  return (
    <>
      {sectionsOnPage(page).map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          rows={state.sections[section.id] ?? []}
          changed={changed}
          onApply={onApply}
          fileName={fileName}
        />
      ))}
      {removed.length > 0 && <RemovedTray entries={removed} onApply={onApply} />}
    </>
  );
}
