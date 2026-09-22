"use client";

import { useCallback, useMemo } from "react";
import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";
import type { Annotated, MatchAnnotation } from "@/lib/imports/types";
import { candidatesForRow } from "@/lib/imports/candidates-for-row";
import { isAmbiguousMatch } from "@/lib/imports/commit/ambiguous-rows";
import { isUnpricedProperty } from "@/lib/imports/commit/account-category";
import { propertyAddressMatches } from "@/lib/imports/commit/mortgage-link";
import type { LiabilityCandidate } from "@/lib/imports/match-keys/liability";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import EntityTable, { formatValue } from "./entity-table";
import type { ExcludedRow } from "./excluded-rows";
import {
  liabilityColumns,
  EMPTY_LIABILITY_COLUMNS_CONTEXT,
} from "./liabilities-columns";

type Row = Annotated<ExtractedLiability>;
type AccountRow = Annotated<ExtractedAccount>;

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
  /**
   * The ACCOUNTS table's rows — not rendered here, and not the Match column's
   * options either. Spec §7 binds this table's Commit button to post the
   * matching property's row id alongside the debt's, and only the caller knows
   * what the accounts table is showing.
   *
   * Optional so the table still renders in a test (and in any caller with no
   * accounts to offer); the co-commit below then finds nothing, which is the
   * pre-branch behaviour rather than a wrong one.
   */
  accounts?: AccountRow[];
}

const NO_CANDIDATES: LiabilityCandidate[] = [];
const NO_ACCOUNTS: AccountRow[] = [];

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
 * The still-uncommitted property row this debt's Commit must carry with it.
 *
 * Spec §7: the Commit button posts both tabs WITH BOTH ROW IDS when the
 * liability has a synthesized property that is not yet committed. Without it
 * `commitAccounts` filters every account row out, `matchMortgageToProperty`
 * finds no property, and `linked_property_id` lands NULL — the debt shows
 * against no house on the estate and techniques screens, silently (final
 * review I1).
 *
 * Matched on ADDRESS EQUALITY, the same first test `splitMortgageEscrow`
 * applies (`mortgage-escrow.ts:87`), and restricted to `category ===
 * "real_estate"` because that is the filter the split itself used — this has
 * to find the row the split actually targeted, not re-decide the match. The
 * split stamps `propertyAddress` onto whichever property it picked, so the
 * synthesized row and an existing one it matched are both reachable here.
 * `find`, not a uniqueness check, for the same reason: the split used `find`.
 *
 * An ALREADY-COMMITTED property is deliberately not returned. It is on the
 * plan, so the debt's own commit will link to it through the server's
 * `matchMortgageToProperty` with no help from here.
 *
 * An AMBIGUOUS (`match.kind === "fuzzy"`) property is not returned either.
 * `commitAccounts` bumps `skipped` and `continue`s on a fuzzy row, writing
 * nothing, while `useChatCommit` marks every POSTED id committed regardless of
 * the server's answer — so co-posting one would make both rows read
 * "Committed" with no house written and `linked_property_id` NULL. A fuzzy
 * row's own Commit button is already withheld for this exact reason
 * (`accountCommitBlockedReason` → "Pick a match first"); this co-post is a
 * second door onto the same write, so it asks the same question. The debt
 * still commits — an unresolvable house is simply not dragged along with it.
 *
 * Cited by SYMBOL, not line: both line references this rule was first written
 * against had already drifted by the time it was implemented.
 */
export function coCommitProperty(
  row: Row,
  accounts: AccountRow[],
  committedRowIds: readonly string[],
): AccountRow | null {
  const address = row.propertyAddress?.trim();
  if (!address) return null;
  return (
    accounts.find(
      (a) =>
        !!a.__rowId &&
        !committedRowIds.includes(a.__rowId) &&
        !isAmbiguousMatch(a) &&
        a.category === "real_estate" &&
        propertyAddressMatches(a.propertyAddress, address),
    ) ?? null
  );
}

/**
 * Why a row's Commit button is withheld.
 *
 * `commitLiabilities` SKIPS a fuzzy row (`commit/liabilities.ts:78-79`) — the
 * POST succeeds, the row writes NOTHING, and the button then reads
 * "Committed". The test comes from `isAmbiguousMatch`, beside the commit code
 * that enforces it, so this cannot drift from what the server actually does.
 *
 * The second reason closes the seam `coCommitProperty` opens (Ruling 73). Once
 * this button also commits the matching property, a value-less property
 * commits as a $0 house through THIS click — I5's defect reached through I1's
 * new door, which neither finding's own fix can see. So the same block the
 * accounts table applies to that row applies here, named for the row it is
 * really about: the debt's own balance is fine, the house's value is not.
 */
export function liabilityCommitBlockedReason(
  row: Row,
  coCommit: AccountRow | null,
): string | null {
  if (isAmbiguousMatch(row)) return "Pick a match first";
  if (coCommit && isUnpricedProperty(coCommit)) return "Enter the property's value first";
  return null;
}

export default function LiabilitiesTable({
  matchCandidates = NO_CANDIDATES,
  accounts = NO_ACCOUNTS,
  onCommitRows,
  ...props
}: LiabilitiesTableProps) {
  const { rows, onEditCell, committedRowIds } = props;
  const options = useMemo(() => matchCandidates.map(pickerOption), [matchCandidates]);

  // Spec §7, in the one place that can honour it: `EntityTable`'s Commit
  // button calls `onCommitRows([rowId])` — a SINGLETON — so the second id has
  // to be contributed by the table that knows both sides. `dropRow`-style
  // de-duplication rather than a bare concat: the accounts table's own Commit
  // may already have named the property in the same click.
  const commitWithProperty = useCallback(
    (rowIds: string[]) => {
      const withProperty = new Set(rowIds);
      for (const rowId of rowIds) {
        const row = rows.find((r) => r.__rowId === rowId);
        const property = row ? coCommitProperty(row, accounts, committedRowIds) : null;
        if (property?.__rowId) withProperty.add(property.__rowId);
      }
      return onCommitRows([...withProperty]);
    },
    [rows, accounts, committedRowIds, onCommitRows],
  );

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
      commitBlockedReason={(row) =>
        liabilityCommitBlockedReason(row, coCommitProperty(row, accounts, committedRowIds))
      }
      totalsNoun={{ one: "debt", many: "debts" }}
      {...props}
      onCommitRows={commitWithProperty}
    />
  );
}
