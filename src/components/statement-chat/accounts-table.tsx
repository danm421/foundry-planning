"use client";

import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { livingHoldings } from "@/lib/imports/living-rows";
import { rollupExclusionReason } from "@/lib/statement-chat/rollups";
import EntityTable from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import { ACCOUNT_COLUMNS } from "./accounts-columns";
import { HoldingsTable } from "./holdings-table";

type Row = Annotated<ExtractedAccount>;

export interface AccountsTableProps {
  rows: Row[];
  excluded: ExcludedRow<Row>[];
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  onEditCell: (rowId: string, field: string, value: unknown) => void;
  onEditHolding: (rowId: string, holdingId: string, field: string, value: unknown) => void;
  onDropHolding: (rowId: string, holdingId: string) => void;
  onRestore?: (row: Row) => void;
  /** Disables every row's Commit button regardless of its own committed/
   *  pending state (Ruling 95, Task 11b fix round 1) — the caller sets this
   *  while a chat turn is sending, so a commit can never interleave with
   *  the turn's own flush-then-adopt round trip. */
  disableCommit?: boolean;
}

/**
 * `excluded-rows.tsx` (generic) renders `reason` verbatim and never
 * reformats `decision` (Task 10 review, Important 4/5) — the account-shaped
 * "a total covering N accounts" wording belongs to account-specific code,
 * not the generic component Phase 2 reuses for annuities and policies.
 * `detectRollups` already populates `reason` for every real payload; this
 * backfills it defensively for a caller that hands in a `decision` with no
 * `reason` of its own, from the SAME wording `detectRollups` uses, so the
 * two can never drift apart into a third copy of the sentence.
 */
function withReason(excluded: ExcludedRow<Row>[]): ExcludedRow<Row>[] {
  return excluded.map((x) => {
    if (x.reason) return x;
    const reason =
      x.decision?.kind === "rollup-excluded" ? rollupExclusionReason(x.decision.coversCount) : x.reason;
    return reason ? { ...x, reason } : x;
  });
}

/**
 * Task 10's public surface, unchanged by the controller amendment's 3-file
 * split — a thin wrapper over the generic `EntityTable` with the accounts
 * column spec applied. Phase 2 adds sibling `<entity>-table.tsx` wrappers
 * the same way, each supplying its own column spec.
 */
export default function AccountsTable({
  excluded,
  committedRowIds,
  onEditHolding,
  onDropHolding,
  ...props
}: AccountsTableProps) {
  return (
    <EntityTable
      columns={ACCOUNT_COLUMNS}
      committedRowIds={committedRowIds}
      excluded={withReason(excluded)}
      expand={(row) =>
        livingHoldings(row).length > 0 && row.__rowId ? (
          <HoldingsTable
            rowId={row.__rowId}
            row={row}
            // A committed row's positions are ALREADY in the plan, and
            // nothing on this surface can update them: the Commit button is
            // spent, `handleCommitRows` will not resend the row, and
            // `finalize` only marks tabs. `edit_holding`/`drop_holding`
            // refuse a committed row outright (`assertNotCommitted` in
            // `tools.ts`), and `EntityTable` already withholds `canEdit` from
            // the account's own cells for the same reason — the positions
            // table was the one surface still offering an edit whose only
            // effect would be to change the screen.
            readOnly={!!row.__rowId && committedRowIds.includes(row.__rowId)}
            onEditHolding={onEditHolding}
            onDropHolding={onDropHolding}
          />
        ) : null
      }
      expandLabel={(row) => `Show positions for ${row.name}`}
      {...props}
    />
  );
}
