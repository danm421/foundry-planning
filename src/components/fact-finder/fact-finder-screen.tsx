"use client";
// src/components/fact-finder/fact-finder-screen.tsx
// The fact finder import screen — the client entry the server page renders:
// header, page rail, the selected page, and the documents & chat panel.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/card";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { PAGE_ORDER, sectionsOnPage, type FFPage } from "@/lib/fact-finder/schema";
import { pageCounts } from "@/lib/fact-finder/screen-summary";
import { countLinksNeedingClick } from "@/lib/fact-finder/state";
import { PanelIcon } from "./icons";
import { PageRail } from "./page-rail";
import type { FactFinderScreenProps } from "./screen-types";
import { SidePanel, useNarrowScreen } from "./side-panel";

const PANEL_ID = "fact-finder-panel";
const PANEL_TITLE = "Documents & chat";
const REVIEW_REASON_ID = "fact-finder-review-reason";

/** Why "Review changes →" can't be pressed yet. */
function reviewBlockedReason(reading: boolean, linksToClick: number): string {
  if (reading) return "Wait for the documents to finish reading.";
  if (linksToClick > 0) return `${linksToClick} ${linksToClick === 1 ? "link needs" : "links need"} a click first.`;
  return "Review arrives in the next update.";
}

export function FactFinderScreen({ clientId, initialState, initialFiles }: FactFinderScreenProps) {
  const state = initialState;
  const reading = filesReading(state, new Date()).length > 0;
  const [page, setPage] = useState<FFPage>("household");
  const [panelOpen, setPanelOpen] = useState(reading);
  const narrow = useNarrowScreen();
  const pageLabel = PAGE_ORDER.find((p) => p.id === page)?.label;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            href={`/clients/${clientId}/details/import`}
            className="text-sm text-ink-3 underline-offset-2 hover:underline"
          >
            ← Back to imports
          </Link>
          <h1 className="text-xl font-semibold text-ink">Fact finder import</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls={PANEL_ID}
            onClick={() => setPanelOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-sm text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
          >
            <PanelIcon />
            {PANEL_TITLE}
          </button>
          <p id={REVIEW_REASON_ID} className="text-xs text-ink-3">
            {reviewBlockedReason(reading, countLinksNeedingClick(state))}
          </p>
          <button
            type="button"
            disabled
            aria-describedby={REVIEW_REASON_ID}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review changes →
          </button>
        </div>
      </header>

      <div
        className={`grid items-start gap-6 ${
          panelOpen && !narrow ? "grid-cols-[200px_minmax(0,1fr)_360px]" : "grid-cols-[200px_minmax(0,1fr)]"
        }`}
      >
        <PageRail counts={pageCounts(state)} selected={page} onSelect={setPage} />

        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">{pageLabel}</h2>
          {sectionsOnPage(page).map((section) => (
            <Card key={section.id} aria-labelledby={`fact-finder-section-${section.id}`}>
              <div className="flex items-center gap-1.5 px-[var(--pad-card)] py-3">
                <h3 id={`fact-finder-section-${section.id}`} className="text-sm font-semibold text-ink-2">
                  {section.label}
                </h3>
                {section.hint && <FieldTooltip text={section.hint} side="bottom" />}
              </div>
            </Card>
          ))}
        </div>

        <SidePanel id={PANEL_ID} title={PANEL_TITLE} open={panelOpen} overlay={narrow} onOpenChange={setPanelOpen}>
          {initialFiles.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-hair">
              {initialFiles.map((file) => (
                <li key={file.id} title={file.name} className="truncate px-4 py-2 text-sm text-ink-2">
                  {file.name}
                </li>
              ))}
            </ul>
          )}
        </SidePanel>
      </div>
    </div>
  );
}
