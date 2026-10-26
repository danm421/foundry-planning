"use client";
// src/components/fact-finder/proposal-card.tsx
// A chat proposal turn: the change lines for the rows the assistant proposed,
// each field with a tick, and "Save N changes to the plan". The card is one of
// four things, decided in this order: Saved (any of its rows has a record the
// plan took at or after the proposal), replaced by a newer proposal, out of
// date (the change list is gone or lacks one of its rows), or live. Imports
// only client-safe leaf modules from src/lib/fact-finder.
import { useId, useMemo } from "react";
import { Card } from "@/components/card";
import type { ChangeLine } from "@/lib/fact-finder/change-set";
import { planSave } from "@/lib/fact-finder/save/plan";
import type { FFChatTurn, FactFinderState } from "@/lib/fact-finder/types";
import { LineItem } from "./change-line";
import { AlertIcon, LoaderIcon } from "./icons";
import type { ChangeTicksStore } from "./use-change-ticks";
import type { SaveError } from "./use-save";

export interface ProposalCardProps {
  state: FactFinderState;
  turn: Extract<FFChatTurn, { role: "proposal" }>;
  /** The newest proposal turn. */
  latest: boolean;
  /** useChangeTicks over state.changeSet. */
  ticks: ChangeTicksStore;
  onSave(): void;
  saving: boolean;
  saveError: SaveError | null;
  /** PATCH the row's link to "new", then review(turn.rowIds). */
  onAddAsNew(line: ChangeLine): void;
  /** review(turn.rowIds). */
  onReviewAgain(): void;
}

const TEXT_BUTTON = "shrink-0 cursor-pointer font-medium text-ink-2 underline underline-offset-2 hover:text-ink hover:no-underline";

const isTickable = (line: ChangeLine) => !line.blocked && line.action !== "none";

function Note({ children }: { children: string }) {
  return <p className="text-sm text-ink-3">{children}</p>;
}

export function ProposalCard({ state, turn, latest, ticks, onSave, saving, saveError, onAddAsNew, onReviewAgain }: ProposalCardProps) {
  const saveReasonId = useId();
  const { changeSet } = state;
  const rows = useMemo(() => new Set(turn.rowIds), [turn.rowIds]);
  const lines = useMemo(() => (changeSet ? changeSet.lines.filter((l) => rows.has(l.rowId)) : []), [changeSet, rows]);
  const saved = (state.applied ?? []).some((a) => rows.has(a.rowId) && a.at >= turn.at);
  // A proposed row that produced no line has nothing to show; only a list with a line for none of them is out of date.
  const stale = !changeSet || lines.length === 0;

  // The save's own plan on the ticks, for the reason each ticked line is left out; only this card's lines show theirs.
  const plan = useMemo(
    () => (changeSet && !saved && latest && !stale ? planSave(changeSet, ticks.ticks, { hasCoClient: changeSet.hasCoClient ?? false }) : null),
    [changeSet, ticks.ticks, saved, latest, stale],
  );
  const leftOut = useMemo(() => (plan?.ok ? Object.fromEntries(plan.leftOut.map((l) => [l.lineId, l.reason])) : {}), [plan]);

  if (saved) return <Note>Saved.</Note>;
  if (!latest) return <Note>Replaced by a newer proposal.</Note>;
  if (stale) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <p>These changes are out of date — something changed since I proposed them.</p>
        <button type="button" onClick={onReviewAgain} className={TEXT_BUTTON}>
          Propose again
        </button>
      </div>
    );
  }

  const count = lines.filter((l) => isTickable(l) && Object.values(ticks.ticks[l.id] ?? {}).some(Boolean)).length;
  const upToDate = lines.filter((l) => l.action === "none" && !l.blocked && l.warnings.length === 0);
  const shown = lines.filter((l) => !upToDate.includes(l));
  const failure = saveError?.lineId ? { lineId: saveError.lineId, message: saveError.message } : null;
  const leftOutCount = lines.filter((l) => leftOut[l.id]).length;
  const waiting = plan && !plan.ok ? plan.error : null;
  return (
    <div className="@container flex flex-col gap-3">
      <Card className="divide-y divide-hair">
        {shown.map((line) => {
          const lineTicks = ticks.ticks[line.id];
          const on = Object.values(lineTicks ?? {}).some(Boolean);
          return (
            <div key={line.id}>
              <LineItem
                line={line}
                lineTicks={lineTicks}
                leftOutReason={leftOut[line.id]}
                failure={failure?.lineId === line.id ? failure.message : undefined}
                onToggleField={ticks.toggleField}
                onToggleLine={ticks.toggleLine}
              />
              {isTickable(line) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-[var(--pad-card)] pb-3 text-sm">
                  <button type="button" onClick={() => ticks.toggleLine(line.id)} className={TEXT_BUTTON}>
                    {on ? "Skip" : "Include"}
                  </button>
                  {line.action === "update" && (
                    <button type="button" onClick={() => onAddAsNew(line)} className={TEXT_BUTTON}>
                      Add as new instead
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {upToDate.length > 0 && (
          <ul className="flex flex-col gap-1 px-[var(--pad-card)] py-3">
            {upToDate.map((line) => (
              <li key={line.id} className="text-sm text-ink-3">
                Already up to date: {line.label}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {saveError && (
        <div className="flex flex-wrap items-start justify-end gap-x-3 gap-y-1 text-sm">
          <p role={failure ? undefined : "alert"} className="flex min-w-0 items-start gap-2 text-crit">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{saveError.message}</span>
          </p>
          {saveError.stale && (
            <button type="button" onClick={onReviewAgain} className={TEXT_BUTTON}>
              Propose again
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {leftOutCount > 0 && (
          <p className="text-xs text-ink-3">
            <span className="tabular">{leftOutCount}</span> left out
          </p>
        )}
        {waiting && (
          <p id={saveReasonId} className="text-xs text-ink-3">
            {waiting}
          </p>
        )}
        <button
          type="button"
          disabled={count === 0 || saving || waiting !== null}
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
            `Save ${count} ${count === 1 ? "change" : "changes"} to the plan`
          )}
        </button>
      </div>
    </div>
  );
}
