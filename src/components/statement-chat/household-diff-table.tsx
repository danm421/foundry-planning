"use client";

import { useId, useState } from "react";
import type { HouseholdDiffRow } from "./household-diff";
import { issueReason } from "./value-issue";

export interface HouseholdDiffTableProps {
  rows: HouseholdDiffRow[];
  /** The accepted field keys, in the order the table shows them. */
  onCommit: (acceptedKeys: string[]) => void;
}

/**
 * Every value in this table is a figure or a name, and the brand sets figures
 * in mono (`.tabular`). `HouseholdDiffRow` carries no `FieldKind` to switch on
 * — by design, it is a display row, not a field spec — so the test is the value
 * itself: a date of birth, a phone, an age and a postal code all contain a
 * digit, and a first or last name does not. Getting it wrong costs a font, not
 * a figure.
 */
function isFigure(value: unknown): boolean {
  return typeof value === "number" || /\d/.test(String(value));
}

function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-4">—</span>;
  }
  return <span className={isFigure(value) ? "tabular" : undefined}>{String(value)}</span>;
}

/**
 * The household's field-level disagreements between the document and the
 * record, each accepted on its own.
 *
 * Unlike every other table on this surface, the household is not a set of
 * candidate ROWS to add — the client already exists, so there is one record and
 * a handful of fields the document contradicts. Accepting a subset is the whole
 * interaction; `buildHouseholdCommitRow` turns the accepted keys back into a
 * `CandidateRow` so the write still goes through `buildWriteRequest` and the
 * same audit path as everything else.
 *
 * Nothing is pre-checked. Four of these fields re-derive the plan horizon in
 * every scenario, so "accept everything the document says" is not a safe
 * default to hand the advisor — each row is an explicit yes.
 */
export default function HouseholdDiffTable({ rows, onCommit }: HouseholdDiffTableProps) {
  const noteId = useId();
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());

  // A household the document agrees with is not an empty table with a dead
  // button — it is nothing to review, and nothing to show.
  if (rows.length === 0) return null;

  const toggle = (key: string) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Row order, not click order: the keys the advisor sees top to bottom are the
  // keys the writer receives.
  const acceptedKeys = rows.filter((row) => accepted.has(row.key)).map((row) => row.key);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Household details found in the document">
        <thead>
          <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">On record</th>
            <th className="px-3 py-2 font-medium">Found in document</th>
            <th className="px-3 py-2 font-medium">Accept</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // A flagged value is refused by `buildWriteRequest` anyway — the
            // checkbox is withheld rather than left live so the advisor is told
            // here, not by a refusal after they pressed Update.
            const issue = row.issue;
            const rowNoteId = `${noteId}-${row.key}`;
            const hasNote = issue !== undefined || row.movesPlanHorizon;

            return (
              <tr key={row.key} className="border-b border-hair last:border-0 align-top">
                <th scope="row" className="px-3 py-2 font-medium text-ink">
                  {row.label}
                  {hasNote && (
                    <div id={rowNoteId} className="mt-1 text-xs font-normal normal-case">
                      {/* Text, never a color alone (`color-not-only`) — the
                          sentence carries the meaning and the warn tone is
                          only the accent on it. */}
                      {row.movesPlanHorizon && (
                        <div className="text-warn">
                          Accepting this re-derives the plan horizon in every scenario.
                        </div>
                      )}
                      {/* One vocabulary for a flagged value, shared with the
                          row tables beside this one (`value-issue.ts`). */}
                      {issue && (
                        <div className="text-ink-3">
                          Cannot be accepted — {issueReason(issue)}.
                        </div>
                      )}
                    </div>
                  )}
                </th>
                <td className="px-3 py-2 text-ink-2">
                  <ValueCell value={row.onRecord} />
                </td>
                <td className="px-3 py-2 text-ink">
                  <ValueCell value={row.found} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={accepted.has(row.key)}
                    disabled={issue !== undefined}
                    onChange={() => toggle(row.key)}
                    // Named rather than wrapped in a `<label>`: the label text
                    // sits in another cell, and the row's note belongs to the
                    // DESCRIPTION so the control's own name stays the field.
                    aria-label={`Accept ${row.label}`}
                    aria-describedby={hasNote ? rowNoteId : undefined}
                    className="h-4 w-4 cursor-pointer rounded border-hair bg-card-2 accent-accent disabled:cursor-default disabled:opacity-50"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          onClick={() => onCommit(acceptedKeys)}
          disabled={acceptedKeys.length === 0}
          // The same control the entity tables on this surface use for their
          // own Commit, so one screen reads as one screen. Hover rules are
          // `enabled:`-scoped because CSS :hover still matches a disabled
          // button.
          className="rounded border border-hair px-2.5 py-1 text-xs font-medium text-accent transition-[color,background-color,border-color,transform] duration-150 enabled:cursor-pointer enabled:hover:border-accent enabled:hover:bg-accent-wash enabled:hover:text-accent-ink motion-safe:enabled:hover:-translate-y-px disabled:cursor-default disabled:text-ink-4 disabled:opacity-60"
        >
          Update household
        </button>
        <span className="text-xs text-ink-3">
          {acceptedKeys.length === 0 ? (
            "Nothing accepted yet."
          ) : (
            <>
              <span className="tabular">{acceptedKeys.length}</span>{" "}
              {acceptedKeys.length === 1 ? "field" : "fields"} will be written to the record.
            </>
          )}
        </span>
      </div>
    </div>
  );
}
