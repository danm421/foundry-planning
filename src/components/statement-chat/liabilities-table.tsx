"use client";

import { useMemo } from "react";
import type { ExtractedLiability } from "@/lib/extraction/types";
import type { Annotated, MatchAnnotation } from "@/lib/imports/types";
import { candidatesForRow } from "@/lib/imports/candidates-for-row";
import { isAmbiguousMatch } from "@/lib/imports/commit/ambiguous-rows";
import type { LiabilityCandidate } from "@/lib/imports/match-keys/liability";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import EntityTable, { formatValue } from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import {
  liabilityColumns,
  EMPTY_LIABILITY_COLUMNS_CONTEXT,
} from "./liabilities-columns";

type Row = Annotated<ExtractedLiability>;

export interface LiabilitiesTableProps {
  rows: Row[];
  excluded: ExcludedRow<Row>[];
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  onEditCell: (rowId: string, field: string, value: unknown) => void;
  onRestore?: (row: Row) => void;
  /** Set while a chat turn is sending — see `AccountsTableProps.disableCommit`. */
  disableCommit?: boolean;
  /** The liabilities already on the plan: the Match column's option list. */
  matchCandidates?: LiabilityCandidate[];
}

const NO_CANDIDATES: LiabilityCandidate[] = [];

/**
 * Enough of an existing liability to tell two of them apart in the picker.
 *
 * Balance is the AMOUNT, not the subtitle: `LiabilityCandidate` carries no
 * rate (`{id, name, balance}` — `match-keys/liability.ts:5-9`), so it is the
 * one fact this picker has beyond the name. Putting it in `subtitle` too
 * would print it twice — `MatchLinkPicker` renders `amount` opposite the
 * name and `subtitle` on its own second line
 * (`match-link-picker.tsx:118-128`) as two separate nodes, not a shared one.
 */
function pickerOption(l: LiabilityCandidate): MatchCandidate {
  return {
    id: l.id,
    name: l.name,
    amount: formatValue("money", l.balance),
  };
}

/**
 * Why a row's Commit button is withheld.
 *
 * `commitLiabilities` SKIPS a fuzzy row (`commit/liabilities.ts:78-79`) — the
 * POST succeeds, the row writes NOTHING, and the button then reads
 * "Committed". The test comes from `isAmbiguousMatch`, beside the commit code
 * that enforces it, so this cannot drift from what the server actually does.
 */
export function liabilityCommitBlockedReason(row: Row): string | null {
  return isAmbiguousMatch(row) ? "Pick a match first" : null;
}

export default function LiabilitiesTable({
  matchCandidates = NO_CANDIDATES,
  ...props
}: LiabilitiesTableProps) {
  const { rows, onEditCell } = props;
  const options = useMemo(() => matchCandidates.map(pickerOption), [matchCandidates]);

  // Built HERE, not in the column spec, because `candidatesForRow` withholds a
  // record another row already claimed and that is only knowable across rows.
  const match = useMemo(() => {
    const matches = rows.map((r) => r.match);
    return {
      candidatesByRowId: new Map(
        rows.map((r, i) => [r.__rowId, candidatesForRow(i, matches, options)] as const),
      ),
      onPick: (row: Row, next: MatchAnnotation) => {
        if (!row.__rowId) return;
        onEditCell(row.__rowId, "match", next);
        onEditCell(row.__rowId, "matchLocked", true);
      },
    };
  }, [rows, options, onEditCell]);

  return (
    <EntityTable
      columns={liabilityColumns({ ...EMPTY_LIABILITY_COLUMNS_CONTEXT, match })}
      commitBlockedReason={liabilityCommitBlockedReason}
      totalsNoun={{ one: "debt", many: "debts" }}
      {...props}
    />
  );
}
