"use client";

import { findEntity, type DetailsTab } from "@/domain/forge/detail-fields";
import { REVIEW_THRESHOLD } from "@/lib/entity-extraction";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { buildWriteRequest } from "@/lib/entity-writer";
import { isAmbiguousMatch } from "@/lib/imports/commit/ambiguous-rows";
import EntityTable from "./entity-table";
import { columnsForEntity, overflowFields, renderOverflow, type CandidateRowView } from "./map-columns";
import { issueReason } from "./value-issue";

/**
 * Details-sidebar order. A tab this list omits sorts LAST, never first (Task
 * 12 ruling 10) — `DetailsTab` has eight members and only three of them read
 * documents today, so an entity on one of the other five (a plain
 * `TAB_ORDER.indexOf` would return -1 for those and sort them to the front,
 * the opposite of "anything on another tab sorts last") must not jump ahead
 * of the tabs this task actually orders.
 */
const TAB_ORDER: DetailsTab[] = ["net-worth", "income-expenses", "insurance"];

function tabRank(tab: DetailsTab): number {
  const i = TAB_ORDER.indexOf(tab);
  return i === -1 ? TAB_ORDER.length : i;
}

export interface EntityTablesProps {
  rows: Record<string, CandidateRow[]>;
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  /**
   * Optional (Task 14b fix round 1, Finding 3). `columnsForEntity`
   * (`map-columns.ts`) builds no `edit` callback, so `entity-table.tsx`'s own
   * `canEdit` is always false and this can never fire for a map-driven table.
   * Kept in the signature for the tests that already pass one, and for a
   * future task that adds real cell editors.
   */
  onEditCell?: (rowId: string, field: string, value: unknown) => void;
}

function toView(row: CandidateRow): CandidateRowView {
  const view: CandidateRowView = { __rowId: row.rowId };
  for (const value of row.values) {
    view[value.key] = value.value;
    // I6 (Ruling 35): the reason travels WITH the value. Dropping it here is
    // what let an off-enum "Universal Life" render as ordinary text in the
    // Policy type column, against the spec's own "a value that cannot be
    // placed, validated or written is visible with its reason attached".
    if (value.issue) {
      view.__issues = { ...view.__issues, [value.key]: value.issue };
    }
  }
  return view;
}

/**
 * One review table per extracted entity, columns built straight from the
 * Details field map (`map-columns.ts`) instead of hand-written per entity.
 *
 * Two "why can't I commit this row?" mechanisms on one table would fight each
 * other, so this reuses `entity-table.tsx`'s existing `commitBlockedReason`
 * for everything that actually blocks a commit, and only adds `rowNotice` for
 * the things that block nothing: a sub-threshold confidence marker, and the
 * word "Add".
 *
 * ONE RULE, stated once: this table may never say "committable" where the
 * writer would refuse, or "will update" where the writer would create. The
 * legs of `commitBlockedReason` below name, in the advisor's own words, the
 * refusals worth naming — an `exact` match with no update leg (Ruling 34), an
 * unresolved `fuzzy` match (the SAME `isAmbiguousMatch` every commit module
 * enforces, reused rather than re-derived), a missing required field, and any
 * flagged value (Ruling 35) — and then ASK `buildWriteRequest`
 * (`src/lib/entity-writer/build-request.ts`) for anything they missed, rather
 * than keeping a second copy of its rules that can drift from it.
 */
export default function EntityTables({
  rows,
  committedRowIds,
  onCommitRows,
  onEditCell,
}: EntityTablesProps) {
  const groups = Object.entries(rows)
    .filter(([, entityRows]) => entityRows.length > 0)
    .flatMap(([entityId, entityRows]) => {
      const entity = findEntity(entityId);
      return entity ? [{ entity, entityRows }] : [];
    })
    .sort((a, b) => {
      const byTab = tabRank(a.entity.tab) - tabRank(b.entity.tab);
      return byTab !== 0 ? byTab : a.entity.label.localeCompare(b.entity.label);
    });

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ entity, entityRows }) => {
        // Built once per entity rather than an `entityRows.find(...)` inside
        // each callback below — same rowId->row idiom `use-chat-commit.ts`
        // already uses, and it turns three O(n) scans per row into one O(n)
        // build reused by all three.
        const byRowId = new Map(entityRows.map((r) => [r.rowId, r] as const));
        // Fields past the column cap (Task 12 review, Important 2) — computed
        // once per entity, not per row, and shared by `expand`/`expandLabel`.
        const overflow = overflowFields(entity);

        return (
          <section key={entity.id}>
            <h3 className="mb-2 text-sm font-medium text-ink">{entity.label}</h3>
            <EntityTable
              ariaLabel={entity.label}
              columns={columnsForEntity(entity)}
              rows={entityRows.map(toView)}
              excluded={[]}
              committedRowIds={committedRowIds}
              onCommitRows={onCommitRows}
              // Never invoked — see the prop's own comment. `entity-table.tsx`
              // requires the prop, so an unreachable no-op stands in for it
              // rather than widening that component's contract too.
              onEditCell={onEditCell ?? (() => {})}
              expand={(view) => renderOverflow(overflow, view)}
              expandLabel={() =>
                `Show ${overflow.length} more field${overflow.length === 1 ? "" : "s"}`
              }
              commitBlockedReason={(view) => {
                const source = byRowId.get(view.__rowId);
                if (!source) return null;
                // Name every field the way the advisor sees it on screen. A
                // payload key means nothing to the person reading this.
                const labelFor = (key: string) =>
                  entity.fields.find((f) => f.key === key)?.label ?? key;
                // C1 (final review, Ruling 34). An `exact` match names a
                // record that ALREADY exists, and `buildWriteRequest` has no
                // update leg — every non-array entity returns
                // `POST routes.create`. So the one row this table used to
                // promise an "Update" for was the one it DUPLICATED, and the
                // stamp then pointed at the duplicate. Refuse honestly and
                // name the screen that can finish it, the same posture the
                // `fuzzy` leg already takes.
                if (source.match?.kind === "exact") {
                  return `This ${entity.label.toLowerCase()} already exists — update it on the Details tab`;
                }
                // The exact rule every commit module in
                // `AMBIGUOUS_ROW_SOURCES` enforces: an unresolved `fuzzy`
                // match is a candidate LIST with no chosen record, so the row
                // would POST, write nothing, and still read "Committed"
                // (Task 12 review, Critical 1).
                if (isAmbiguousMatch(source)) return "Pick a match first";
                if (source.missingRequired.length > 0) {
                  return `Missing ${source.missingRequired.map(labelFor).join(", ")}`;
                }
                // C2 (final review, Ruling 35). `build-request.ts:42-50`
                // refuses the WHOLE write when ANY value carries ANY issue,
                // optional fields included — and `confidence.ts:46-48` stamps
                // `ungrounded` on every snippet-less value, so one optional
                // `cashValue` with no snippet was enough. Without this the
                // button stayed enabled and threw the writer's refusal
                // underneath it, on a table with no cell editing to clear the
                // flag with: the row was dead until the whole extraction was
                // re-run. Same class as the Task 12 Critical the `fuzzy` leg
                // closed — the table must never say "committable" where the
                // writer would refuse.
                const flagged = source.values.filter((v) => v.issue);
                if (flagged.length > 0) {
                  const named = flagged.map(
                    (v) => `${labelFor(v.key)} (${issueReason(v.issue!)})`,
                  );
                  return `Check ${named.join(", ")}`;
                }
                // Last leg: the WRITER's own verdict, asked rather than
                // copied, so this table cannot drift from what Commit would
                // actually do. It is the only thing that knows the ROUTE's own
                // create schema (I4, Ruling 36) — a term policy with every
                // map-`required` field filled still needs a term issue year,
                // and a disability policy still needs an LTD benefit-period
                // age. Nothing above can see either. `buildWriteRequest` is
                // pure, so this costs one object build per row.
                //
                // The legs above are not redundant with it: they name fields
                // by their on-screen labels, and it names payload keys.
                const request = buildWriteRequest({ entity, row: source });
                return request.ok ? null : request.error;
              }}
              rowNotice={(view) => {
                const source = byRowId.get(view.__rowId);
                if (!source) return {};
                return {
                  // Low confidence MARKS the row. It never pre-selects discard —
                  // hiding a value is the failure mode Phase 1 already rejected.
                  needsReview: source.rowConfidence < REVIEW_THRESHOLD,
                  // "Update" is GONE (Ruling 34). It described a leg
                  // `buildWriteRequest` does not have, and an `exact` match is
                  // now blocked above with its own reason — so the only state
                  // left for an action word to describe is a row that will be
                  // added. An exact match gets no word at all rather than a
                  // contradictory "Add" beside "this already exists".
                  action: source.match?.kind === "exact" ? undefined : "Add",
                };
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
