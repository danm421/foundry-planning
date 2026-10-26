"use client";
// src/components/fact-finder/change-list.tsx
// The review's change list, shown in place of a fact finder page: what saving
// would create or update on the plan, page by page and field by field ("on
// record → new"), each field with a tick. A line that can't save says why and
// goes back to the cell to fix; unchanged lines fold away. "Save to plan" writes
// the ticked fields; a line the ticks leave out says why in place, and a line the
// save couldn't write is ringed with its reason. Imports only client-safe leaf
// modules from src/lib/fact-finder.
import { Fragment, useId, useMemo, type Ref } from "react";
import { Card } from "@/components/card";
import { SAVE_NOTHING_MESSAGE } from "@/lib/fact-finder/api-types";
import { countLines, type CellRef, type ChangeLine, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { PAGE_ORDER } from "@/lib/fact-finder/schema";
import { planSave, type SavePlan } from "@/lib/fact-finder/save/plan";
import { GHOST_BUTTON } from "./button-styles";
import { LineItem, sectionLabel } from "./change-line";
import { AlertIcon, ChevronDownIcon, LoaderIcon } from "./icons";
import type { SaveError } from "./use-save";

export interface ChangeListProps {
  changeSet: ChangeSet;
  ticks: ChangeTicks;
  onToggleField(lineId: string, key: string): void;
  onToggleLine(lineId: string): void;
  /** Back to the fact finder at the cell to fix, else at the line's section. */
  onFix(cell: CellRef | undefined, sectionId: string): void;
  onBack(): void;
  /** Whether the plan has a co-client already — for a change list that doesn't record what the review saw (the save plans with the same). */
  hasCoClient: boolean;
  /** A document is being read: its rows would land after the save, on a closed import. */
  reading: boolean;
  /** A chat message or Undo is on its way: its edit would land after the save. */
  chatting: boolean;
  onSave(): void;
  saving: boolean;
  /** Why the last save didn't go through. */
  saveError: SaveError | null;
  /** A stale list or record: build the change list again. */
  onReviewAgain(): void;
  onDismissSaveError(): void;
  /** The "Changes to the plan" heading, which the screen focuses when the list opens. */
  headingRef?: Ref<HTMLHeadingElement>;
}

type GroupProps = Pick<ChangeListProps, "ticks" | "onToggleField" | "onToggleLine" | "onFix"> & {
  /** lineId → why the ticks leave the line out of the save. */
  leftOut: Readonly<Record<string, string>>;
  /** The line the last save couldn't write, with its reason. */
  failure: { lineId: string; message: string } | null;
};

/** The heading over the review, wherever it shows (the list, or the notice that it's out of date). Focus goes to it when the list opens. */
export function ChangesHeading({ ref }: { ref?: Ref<HTMLHeadingElement> }) {
  return (
    <h2 ref={ref} tabIndex={-1} className={HEADING_FOCUS_TARGET}>
      Changes to the plan
    </h2>
  );
}

/** A heading focus is moved to (not tabbed to): the page's, or the change list's. */
export const HEADING_FOCUS_TARGET =
  "rounded-[var(--radius-sm)] text-lg font-semibold text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function BackToFactFinder({ onClick }: { onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={GHOST_BUTTON}>
      <span aria-hidden="true">←</span>
      Back to fact finder
    </button>
  );
}

/** "12 to create · 8 to update · 3 can't save · 5 unchanged", leaving out what there's none of. */
function Summary({ lines }: { lines: readonly ChangeLine[] }) {
  const { creates, updates, blocked, unchanged } = countLines(lines);
  const parts = (
    [
      [creates, "to create"],
      [updates, "to update"],
      [blocked, "can't save"],
      [unchanged, "unchanged"],
    ] as const
  ).filter(([n]) => n > 0);
  if (parts.length === 0) return <p className="text-sm text-ink-2">Nothing here changes the plan.</p>;
  return (
    <p className="text-sm text-ink-2">
      {parts.map(([n, words], i) => (
        <Fragment key={words}>
          {i > 0 && <span className="text-ink-4"> · </span>}
          <span className="tabular">{n}</span> {words}
        </Fragment>
      ))}
    </p>
  );
}

/** A page's lines that change nothing, folded into one closed disclosure. */
function Unchanged({ lines }: { lines: readonly ChangeLine[] }) {
  return (
    <details className="group px-[var(--pad-card)] py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon className="h-4 w-4 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" />
        <span>
          <span className="tabular">{lines.length}</span> unchanged
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 pl-6">
        {lines.map((line) => (
          <li key={line.id} className="text-sm text-ink-2">
            {line.label} <span className="text-xs text-ink-3">{sectionLabel(line)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PageGroup({ label, lines, ticks, leftOut, failure, ...lineProps }: GroupProps & { label: string; lines: readonly ChangeLine[] }) {
  const headingId = useId();
  // An unchanged line with a warning stays in view; the rest fold away.
  const unchanged = lines.filter((l) => !l.blocked && l.action === "none" && l.warnings.length === 0);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-ink-2">
        {label}
      </h3>
      <Card className="divide-y divide-hair">
        {lines
          .filter((l) => !unchanged.includes(l))
          .map((line) => (
            <LineItem
              key={line.id}
              line={line}
              lineTicks={ticks[line.id]}
              leftOutReason={leftOut[line.id]}
              failure={failure?.lineId === line.id ? failure.message : undefined}
              {...lineProps}
            />
          ))}
        {unchanged.length > 0 && <Unchanged lines={unchanged} />}
      </Card>
    </section>
  );
}

const NO_CHANGES_MESSAGE = "Nothing to save yet — the fact finder has no changes for the plan.";

/** Why Save to plan can't be pressed yet — something still on its way to the fact finder, or the plan's own reason; null when it can. */
function saveBlockedReason(changeSet: ChangeSet, plan: SavePlan, reading: boolean, chatting: boolean): string | null {
  if (reading) return "Wait for the documents to finish reading.";
  if (chatting) return "Wait for the chat to finish.";
  if (!plan.ok) return plan.error;
  if (plan.lines.length > 0) return null;
  // No line changes the plan at all (an empty import), or the ticks leave out every one that does.
  return changeSet.lines.every((line) => line.action === "none") ? NO_CHANGES_MESSAGE : SAVE_NOTHING_MESSAGE;
}

export function ChangeList({
  changeSet, onBack, hasCoClient, reading, chatting, onSave, saving, saveError, onReviewAgain, onDismissSaveError, headingRef, ...groupProps
}: ChangeListProps) {
  const saveReasonId = useId();
  // The save's own plan, run on the ticks: what it writes, and what the ticks leave out with their reasons. With the
  // co-client the review saw, as the server plans it.
  const plan = useMemo(
    () => planSave(changeSet, groupProps.ticks, { hasCoClient: changeSet.hasCoClient ?? hasCoClient }),
    [changeSet, groupProps.ticks, hasCoClient],
  );
  const leftOut = useMemo(
    () => (plan.ok ? Object.fromEntries(plan.leftOut.map((l) => [l.lineId, l.reason])) : {}),
    [plan],
  );
  const failure = saveError?.lineId ? { lineId: saveError.lineId, message: saveError.message } : null;
  const waiting = saveBlockedReason(changeSet, plan, reading, chatting);
  return (
    <div className="@container flex flex-col gap-4">
      <ChangesHeading ref={headingRef} />
      <Summary lines={changeSet.lines} />
      {changeSet.notices.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
          {changeSet.notices.map((notice, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      )}
      {PAGE_ORDER.map(({ id, label }) => {
        const lines = changeSet.lines.filter((l) => l.page === id);
        return lines.length > 0 && <PageGroup key={id} label={label} lines={lines} leftOut={leftOut} failure={failure} {...groupProps} />;
      })}
      <div className="flex flex-col gap-3 border-t border-hair pt-4">
        {saveError && (
          <div className="flex flex-wrap items-start justify-end gap-x-3 gap-y-1 text-sm">
            <p role={failure ? undefined : "alert"} className="flex min-w-0 items-start gap-2 text-crit">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{saveError.message}</span>
            </p>
            {saveError.stale && (
              <button
                type="button"
                onClick={onReviewAgain}
                className="shrink-0 cursor-pointer font-medium text-ink-2 underline underline-offset-2 hover:text-ink hover:no-underline"
              >
                Review again
              </button>
            )}
            <button
              type="button"
              onClick={onDismissSaveError}
              className="shrink-0 cursor-pointer text-ink-3 underline underline-offset-2 hover:text-ink hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackToFactFinder onClick={onBack} />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {plan.ok && plan.leftOut.length > 0 && (
              <p className="text-xs text-ink-3">
                <span className="tabular">{plan.leftOut.length}</span> left out
              </p>
            )}
            {waiting && (
              <p id={saveReasonId} className="text-xs text-ink-3">
                {waiting}
              </p>
            )}
            <button
              type="button"
              disabled={waiting !== null || saving}
              onClick={onSave}
              aria-describedby={waiting ? saveReasonId : undefined}
              className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors enabled:cursor-pointer enabled:hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <LoaderIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Saving…
                </>
              ) : (
                "Save to plan"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
