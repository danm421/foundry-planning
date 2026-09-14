"use client";

import { findEntity, type DetailsTab } from "@/domain/forge/detail-fields";
import { REVIEW_THRESHOLD } from "@/lib/entity-extraction";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import EntityTable from "./entity-table";
import { columnsForEntity, type CandidateRowView } from "./map-columns";

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
  onEditCell: (rowId: string, field: string, value: unknown) => void;
}

function toView(row: CandidateRow): CandidateRowView {
  const view: CandidateRowView = { __rowId: row.rowId };
  for (const value of row.values) view[value.key] = value.value;
  return view;
}

/**
 * One review table per extracted entity, columns built straight from the
 * Details field map (`map-columns.ts`) instead of hand-written per entity.
 *
 * Two "why can't I commit this row?" mechanisms on one table would fight each
 * other, so this reuses `entity-table.tsx`'s existing `commitBlockedReason`
 * for the one thing that actually blocks a commit (a missing required field)
 * and only adds `rowNotice` for the two things that don't: a sub-threshold
 * confidence marker, and Add-vs-Update wording driven by the match kind
 * (Task 12 ruling 7).
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
        // each of the two callbacks below — same rowId->row idiom
        // `use-chat-commit.ts` already uses, and it turns two O(n) scans per
        // row into one O(n) build reused by both.
        const byRowId = new Map(entityRows.map((r) => [r.rowId, r] as const));

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
              onEditCell={onEditCell}
              commitBlockedReason={(view) => {
                const source = byRowId.get(view.__rowId);
                if (!source || source.missingRequired.length === 0) return null;
                // Name the missing fields the way the advisor sees them on
                // screen. A payload key means nothing to the person reading this.
                const missing = source.missingRequired.map(
                  (key) => entity.fields.find((f) => f.key === key)?.label ?? key,
                );
                return `Missing ${missing.join(", ")}`;
              }}
              rowNotice={(view) => {
                const source = byRowId.get(view.__rowId);
                if (!source) return {};
                return {
                  // Low confidence MARKS the row. It never pre-selects discard —
                  // hiding a value is the failure mode Phase 1 already rejected.
                  needsReview: source.rowConfidence < REVIEW_THRESHOLD,
                  action: source.match && source.match.kind !== "new" ? "Update" : "Add",
                };
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
