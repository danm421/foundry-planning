"use client";

import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { rollupExclusionReason } from "@/lib/statement-chat/rollups";
import EntityTable from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import { ACCOUNT_COLUMNS } from "./accounts-columns";

type Row = Annotated<ExtractedAccount>;

export interface AccountsTableProps {
  rows: Row[];
  excluded: ExcludedRow<Row>[];
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  onEditCell: (rowId: string, field: string, value: unknown) => void;
  onRestore?: (row: Row) => void;
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
export default function AccountsTable({ excluded, ...props }: AccountsTableProps) {
  return <EntityTable columns={ACCOUNT_COLUMNS} excluded={withReason(excluded)} {...props} />;
}
