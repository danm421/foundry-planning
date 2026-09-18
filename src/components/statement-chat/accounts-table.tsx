"use client";

import { useMemo } from "react";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated, MatchAnnotation } from "@/lib/imports/types";
import { livingHoldings } from "@/lib/imports/living-rows";
import { candidatesForRow } from "@/lib/imports/candidates-for-row";
import { isAmbiguousMatch } from "@/lib/imports/commit/ambiguous-rows";
import { isUnpricedProperty } from "@/lib/imports/commit/account-category";
import type { AccountCandidate } from "@/lib/imports/match-keys/account";
import { formatAccountCategory } from "@/lib/accounts/category-labels";
import { rollupExclusionReason } from "@/lib/statement-chat/rollups";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import EntityTable, { formatValue } from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import {
  accountColumns,
  EMPTY_ACCOUNT_COLUMNS_CONTEXT,
  type AccountColumnsContext,
} from "./accounts-columns";
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
  /**
   * The plan's roster, for the Owner column. Optional so a test (and the
   * brief's own unchangeable ones) can construct this table without it; the
   * Owner cell then falls back to the printed registration name.
   */
  columnsContext?: AccountColumnsContext;
  /**
   * The accounts already on the plan this import commits into — the Match
   * column's option list. Empty (the default) leaves every row reading "New",
   * which is the honest answer for a plan with nothing to match against.
   */
  matchCandidates?: AccountCandidate[];
}

/**
 * Enough of an existing account to tell two similar ones apart in the picker.
 * The search box filters on name AND subtitle, so owner, custodian and last 4
 * are searchable too — which is how an advisor finds the right "Brokerage"
 * among four of them.
 *
 * OWNER leads the subtitle and VALUE is lifted out onto its own line opposite
 * the name. Whenever the matcher cannot settle a row the advisor settles it by
 * hand, and the two questions they ask of a candidate are "is this the right
 * person's account" and "is that roughly the right money" — a picker that
 * answers neither without leaving the page is the reason a row stays
 * Ambiguous. Custodian, last 4 and category stay, after the owner, because
 * they are what separates two of one person's accounts from each other.
 */
const NO_CANDIDATES: AccountCandidate[] = [];

function pickerOption(a: AccountCandidate): MatchCandidate {
  const parts = [
    a.ownerNames?.length ? a.ownerNames.join(" & ") : null,
    a.custodian,
    a.accountNumberLast4 ? `x${a.accountNumberLast4}` : null,
    formatAccountCategory(a.category),
  ].filter(Boolean);
  return {
    id: a.id,
    name: a.name,
    subtitle: parts.join(" · "),
    amount: formatValue("money", a.value),
  };
}

/**
 * Why a row's Commit button is withheld.
 *
 * `commitAccounts` SKIPS an ambiguous row — the POST succeeds, the row writes
 * NOTHING, and the button then reads "Committed". So an unresolved match has to
 * block the click rather than report a success that never happened. The test
 * itself comes from `isAmbiguousMatch`, beside the commit code that enforces
 * it, so this cannot drift from what the server actually does.
 *
 * The second reason is the opposite failure: `commitAccounts` does NOT skip a
 * value-less property, it writes `"0"` — so the house this import synthesized
 * from a mortgage statement lands on the balance sheet worth nothing, with a
 * real mortgage against it (final review I5). Same source discipline:
 * `isUnpricedProperty` sits beside `resolveAccountCategory`, the function that
 * decides what actually commits.
 */
export function accountCommitBlockedReason(row: Row): string | null {
  if (isAmbiguousMatch(row)) return "Pick a match first";
  if (isUnpricedProperty(row)) return "Enter a value first";
  return null;
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
  onEditHolding,
  onDropHolding,
  columnsContext = EMPTY_ACCOUNT_COLUMNS_CONTEXT,
  matchCandidates = NO_CANDIDATES,
  ...props
}: AccountsTableProps) {
  const { rows, onEditCell } = props;
  const options = useMemo(() => matchCandidates.map(pickerOption), [matchCandidates]);

  // Built HERE rather than in the column spec because it needs the whole row
  // set: `candidatesForRow` withholds a record another row already claimed,
  // and that is only knowable across rows. Computed once per row set rather
  // than once per row per render.
  const match = useMemo(() => {
    const matches = rows.map((r) => r.match);
    return {
      candidatesByRowId: new Map(
        rows.map((r, i) => [r.__rowId, candidatesForRow(i, matches, options)] as const),
      ),
      // `matchLocked` is the other half of the write, not a detail: without it
      // the next annotation pass re-derives `match` and silently re-suggests
      // the match the advisor just rejected.
      onPick: (row: Row, next: MatchAnnotation) => {
        if (!row.__rowId) return;
        onEditCell(row.__rowId, "match", next);
        onEditCell(row.__rowId, "matchLocked", true);
      },
    };
  }, [rows, options, onEditCell]);

  return (
    <EntityTable
      columns={accountColumns({ ...columnsContext, match })}
      excluded={withReason(excluded)}
      commitBlockedReason={accountCommitBlockedReason}
      expand={(row, { isCommitted }) =>
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
            readOnly={isCommitted}
            onEditHolding={onEditHolding}
            onDropHolding={onDropHolding}
          />
        ) : null
      }
      expandLabel={(row) => `Show positions for ${row.name}`}
      totalsNoun={{ one: "account", many: "accounts" }}
      {...props}
    />
  );
}
