"use client";
// src/components/fact-finder/fact-finder-screen.tsx
// The fact finder import screen — the client entry the server page renders:
// header, page rail, the selected page (or the review's change list), and the
// documents & chat panel.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Card } from "@/components/card";
import { cellKey, type CellRef } from "@/lib/fact-finder/change-set";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { PAGE_ORDER, findSection, type FFPage } from "@/lib/fact-finder/schema";
import { pageCounts } from "@/lib/fact-finder/screen-summary";
import { countLinksNeedingClick } from "@/lib/fact-finder/state";
import { BackToFactFinder, ChangeList, ChangesHeading } from "./change-list";
import { ChatComposerBar, ChatPanel, useChat } from "./chat-panel";
import { DocumentsPanel, useDocuments } from "./documents-panel";
import { AlertIcon, LoaderIcon, PanelIcon } from "./icons";
import { PageRail } from "./page-rail";
import { PageView } from "./page-view";
import { SaveStatus } from "./save-status";
import type { FactFinderScreenProps } from "./screen-types";
import { BESIDE_GRID_STYLE, SidePanel, useNarrowScreen } from "./side-panel";
import { useChangeTicks } from "./use-change-ticks";
import { useFactFinder } from "./use-fact-finder";
import { useReview } from "./use-review";
import { useSave } from "./use-save";

const PANEL_ID = "fact-finder-panel";
const PANEL_TITLE = "Documents & chat";
const REVIEW_REASON_ID = "fact-finder-review-reason";
const PRIMARY_BUTTON =
  "inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors " +
  "enabled:cursor-pointer enabled:hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50";

/** Why "Review changes →" can't be pressed yet; null when it can. */
function reviewBlockedReason(reading: boolean, linksToClick: number, pending: boolean): string | null {
  if (reading) return "Wait for the documents to finish reading.";
  if (linksToClick > 0) return `${linksToClick} ${linksToClick === 1 ? "link needs" : "links need"} a click first.`;
  if (pending) return "Wait for your edits to save.";
  return null;
}

/** The ring Fix in fact finder puts on its cell: focus after a mouse click shows none of its own. */
const FIX_RING = ["outline-2", "-outline-offset-2", "outline-accent"];

/**
 * Centres a list cell between its table's left edge and the row's sticky
 * actions, which cover the scroller's right end; a cell wider than that gap
 * starts at the left edge. Scrolling is instant, so the cell has already moved.
 */
function clearRowActions(target: HTMLElement) {
  const actions = target.closest("tr")?.querySelector<HTMLElement>("[data-row-actions]");
  const scroller = actions?.closest("table")?.parentElement; // the table's sideways scroller
  if (!actions || !scroller) return;
  const left = scroller.getBoundingClientRect().left;
  const gap = actions.getBoundingClientRect().left - left;
  const box = target.getBoundingClientRect();
  scroller.scrollLeft += box.width > gap ? box.left - left : box.left + box.width / 2 - (left + gap / 2);
}

/**
 * Scrolls a fact finder cell (else its section's heading) into the middle of
 * the view, clear of a table's sticky row actions, focuses it (or the control
 * in it) and rings it until focus moves on.
 */
function focusCell(cell: CellRef | undefined, sectionId: string) {
  const target =
    (cell && document.querySelector<HTMLElement>(`[data-cell="${cellKey(cell.rowId, cell.columnId)}"]`)) ??
    document.getElementById(`fact-finder-section-${sectionId}`);
  if (!target) return;
  const control = target.querySelector<HTMLElement>("input, select, textarea, button") ?? target;
  // A heading, or a cell with nothing to edit, takes focus only with a tabindex.
  if (control === target && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.scrollIntoView?.({ block: "center", inline: "center" });
  clearRowActions(target);
  target.classList.add(...FIX_RING);
  target.addEventListener("focusout", () => target.classList.remove(...FIX_RING), { once: true });
  control.focus({ preventScroll: true });
}

export function FactFinderScreen({ clientId, importId, initialState, initialFiles, entities, hasCoClient }: FactFinderScreenProps) {
  const store = useFactFinder({ clientId, importId, initialState });
  const state = store.state;
  const docs = useDocuments({ clientId, importId, initialFiles, state, refresh: store.refresh });
  const reading = docs.read.running || filesReading(state, new Date()).length > 0;
  const chat = useChat({ clientId, importId, flushNow: store.flushNow, adopt: store.adopt });
  const [page, setPage] = useState<FFPage>("household");
  // Open while a document is reading or about to, and when one couldn't be read, so its Retry shows.
  const [panelOpen, setPanelOpen] = useState(
    () => reading || docs.readsOnOpen || docs.files.some((file) => state.readings[file.id]?.status === "failed"),
  );
  // The change list in place of the page: on opening with one, after a review, and on "Review changes →".
  const [showChanges, setShowChanges] = useState(initialState.changeSet !== undefined);
  const narrow = useNarrowScreen();
  const pageLabel = PAGE_ORDER.find((p) => p.id === page)?.label;

  // An edit not yet saved still shows the change set it is about to drop (applyOps keeps it), so it's not current.
  const changes = store.pending ? undefined : state.changeSet;
  const ticks = useChangeTicks(importId, changes);
  const review = useReview({
    clientId,
    importId,
    flushNow: store.flushNow,
    adopt(fresh) {
      store.adopt(fresh);
      save.dismiss();
      if (fresh.changeSet) setShowChanges(true);
    },
  });
  const save = useSave({
    clientId,
    importId,
    onSaved(saved) {
      store.adopt(saved);
      setShowChanges(false);
    },
    // A 409 may carry a fresher fact finder (the list is gone, or newer); the list stays up with the reason when it isn't.
    onStale(fresh) {
      if (fresh) store.adopt(fresh);
    },
  });
  const blockedReason = reviewBlockedReason(reading, countLinksNeedingClick(state), store.pending);
  const canReview = blockedReason === null && !review.reviewing;

  function startReview() {
    // The change set held with no edit since is the current one: show it again, ticks and all.
    if (changes) setShowChanges(true);
    else void review.review();
  }

  function showPage(next: FFPage) {
    setPage(next);
    setShowChanges(false);
  }

  const fix = useCallback((cell: CellRef | undefined, sectionId: string) => {
    const target = findSection(cell?.sectionId ?? sectionId)?.page;
    // The page renders now, so the cell is there to focus.
    flushSync(() => {
      setShowChanges(false);
      if (target) setPage(target);
    });
    focusCell(cell, sectionId);
  }, []);

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
          <SaveStatus
            status={store.status}
            error={store.error}
            notice={store.notice}
            onRetry={store.retry}
            onDismiss={store.dismiss}
          />
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
          {blockedReason && (
            <p id={REVIEW_REASON_ID} className="text-xs text-ink-3">
              {blockedReason}
            </p>
          )}
          <button
            type="button"
            disabled={!canReview}
            onClick={startReview}
            aria-describedby={blockedReason ? REVIEW_REASON_ID : undefined}
            className={PRIMARY_BUTTON}
          >
            {review.reviewing ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Reviewing…
              </>
            ) : (
              "Review changes →"
            )}
          </button>
        </div>
        {review.error && (
          <div className="flex w-full items-start justify-end gap-3 text-sm">
            <p role="alert" className="flex items-start gap-2 text-crit">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {review.error}
            </p>
            <button
              type="button"
              onClick={review.dismiss}
              className="shrink-0 text-ink-3 underline underline-offset-2 hover:text-ink hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </header>

      <div
        className={`grid items-start gap-6 ${
          panelOpen && !narrow ? "grid-cols-[200px_minmax(0,1fr)_360px]" : "grid-cols-[200px_minmax(0,1fr)]"
        }`}
        style={panelOpen && !narrow ? BESIDE_GRID_STYLE : undefined}
      >
        <PageRail counts={pageCounts(state)} selected={showChanges ? null : page} onSelect={showPage} />

        <div className="flex min-w-0 flex-col gap-4">
          {showChanges && changes ? (
            <ChangeList
              changeSet={changes}
              ticks={ticks.ticks}
              onToggleField={ticks.toggleField}
              onToggleLine={ticks.toggleLine}
              onFix={fix}
              onBack={() => setShowChanges(false)}
              hasCoClient={hasCoClient}
              onSave={() => void save.save(changes, ticks.ticks)}
              saving={save.saving}
              saveError={save.error}
              onReviewAgain={() => void review.review()}
              onDismissSaveError={save.dismiss}
            />
          ) : showChanges ? (
            <>
              <ChangesHeading />
              <Card className="flex flex-wrap items-center justify-between gap-3 px-[var(--pad-card)] py-4">
                <p role="status" className="text-sm text-ink-2">
                  {save.error?.stale ? save.error.message : "The fact finder changed — review again."}
                </p>
                <div className="flex items-center gap-3">
                  <BackToFactFinder onClick={() => setShowChanges(false)} />
                  <button
                    type="button"
                    disabled={!canReview}
                    onClick={() => void review.review()}
                    aria-describedby={blockedReason ? REVIEW_REASON_ID : undefined}
                    className={PRIMARY_BUTTON}
                  >
                    Review again
                  </button>
                </div>
              </Card>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">{pageLabel}</h2>
              <PageView page={page} state={state} onApply={store.apply} fileName={docs.fileName} entities={entities} />
            </>
          )}
        </div>

        <SidePanel
          id={PANEL_ID}
          title={PANEL_TITLE}
          open={panelOpen}
          overlay={narrow}
          onOpenChange={setPanelOpen}
          footer={<ChatComposerBar chat={chat} reading={reading} />}
        >
          <DocumentsPanel clientId={clientId} importId={importId} docs={docs} state={state} />
          <ChatPanel chat={chat} state={state} />
        </SidePanel>
      </div>
    </div>
  );
}
