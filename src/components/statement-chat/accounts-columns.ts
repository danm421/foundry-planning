import { createElement } from "react";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated, MatchAnnotation } from "@/lib/imports/types";
import type { AccountOwner } from "@/engine/ownership";
import {
  formatAccountCategory,
  formatAccountSubType,
} from "@/lib/accounts/category-labels";
import { is529Account } from "@/lib/accounts/is-529";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import {
  resolveOwnerDisplay,
  type OwnerEntityOption,
} from "@/lib/statement-chat/owner-options";
import MatchColumn from "@/components/import/match-column";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import type { ColumnSpec } from "./entity-table";
import OwnerCell from "./owner-cell";
import OwnerCellEdit from "./owner-cell-edit";
import AccountTypeCellEdit, {
  type AccountTypePatch,
} from "./account-type-cell";
import { HoldingsCell } from "./holdings-cell";

/**
 * Named `.ts`, not `.tsx`, per the controller amendment's file list. The
 * `render` overrides below build React elements with `createElement`
 * rather than JSX syntax, which a `.ts` file cannot parse (`tsconfig.json`'s
 * `jsx: "react-jsx"` still requires the `.tsx` extension for angle-bracket
 * JSX) — this stays a genuinely JSX-free spec list now that the Account-type
 * editor itself lives in `account-type-cell.tsx` (Task 10 review, Ruling 69
 * revised), so there is nothing here but `createElement(Component, props)`
 * calls with no children needing their own `key` props.
 */

type Row = Annotated<ExtractedAccount>;

/**
 * Display label for the collapsed Account-type cell. Uses the canonical
 * `formatAccountCategory`/`formatAccountSubType` formatters (Task 10 review,
 * Important 9) rather than re-deriving labels by scanning the dropdown
 * option list — that list is curated for the SELECT control, not display,
 * and duplicating a lookup that already exists elsewhere is exactly what
 * `src/lib/accounts/category-labels.ts` was built to prevent.
 */
export function accountTypeLabel(row: Row): string {
  const category = row.category
    ? formatAccountCategory(row.category)
    : undefined;
  const subType = row.subType ? formatAccountSubType(row.subType) : undefined;
  if (category && subType) return `${category} · ${subType}`;
  return category ?? subType ?? "—";
}

/**
 * Everything the Match column needs that only the TABLE can know — the option
 * list depends on what every OTHER row is matched to, and the write goes
 * through the table's own `onEditCell`.
 *
 * Absent means the column renders a read-only badge: still the truth about what
 * the row will do at commit, just not re-rulable. That is what the tests which
 * construct the table bare get, and what a page that never loaded the client's
 * existing accounts would get.
 */
export interface AccountMatchContext {
  /**
   * Each row's picker options, already filtered so an existing account another
   * row has claimed is not offered here too — one existing account can back at
   * most one imported row, or the commit issues two UPDATEs against it.
   * The row's OWN current pick is retained, which is also where the badge gets
   * the matched account's name from.
   */
  candidatesByRowId: ReadonlyMap<string | undefined, MatchCandidate[]>;
  /** Record an advisor's ruling — writes `match` and freezes it with `matchLocked`. */
  onPick: (row: Row, next: MatchAnnotation) => void;
}

/**
 * What the column spec needs to know about the plan the import commits into.
 * Empty is legal and degrades honestly — the Owner cell falls back to the
 * printed registration name, exactly as it behaved before the roster existed.
 */
export interface AccountColumnsContext {
  family: OwnerMatchFamilyMember[];
  entities: OwnerEntityOption[];
  match?: AccountMatchContext;
}

export const EMPTY_ACCOUNT_COLUMNS_CONTEXT: AccountColumnsContext = {
  family: [],
  entities: [],
};

/**
 * The nine-column spec (Name · Value · Basis · Last 4 · Owner · Custodian
 * · Account type · Holdings · Match).
 *
 * A factory rather than a constant since the Owner column has to resolve ids
 * against THIS client's roster. Everything else is context-free and unchanged.
 */
export function accountColumns(ctx: AccountColumnsContext): ColumnSpec<Row>[] {
  const matchCtx = ctx.match;
  return [
    { key: "name", header: "Name", kind: "string" },
    // `total` on Value and NOT on Basis: the household figure an advisor
    // reconciles against the statement in hand is what the accounts are
    // worth. A basis total is a different question nobody asked at this step.
    { key: "value", header: "Value", kind: "money", total: true },
    { key: "basis", header: "Basis", kind: "money" },
    {
      key: "accountNumberLast4",
      header: "Last 4",
      kind: "string",
      // IDs are mono per the design system, independent of alignment.
      render: (row) =>
        row.accountNumberLast4
          ? createElement(
              "span",
              { className: "tabular" },
              row.accountNumberLast4,
            )
          : "—",
    },
    {
      key: "owner",
      header: "Owner",
      kind: "string",
      render: (row) => {
        const { names, assumed } = resolveOwnerDisplay(
          row,
          ctx.family,
          ctx.entities,
        );
        return createElement(OwnerCell, {
          names,
          assumed,
          hint: row.ownerNameHint,
          role: row.owner,
        });
      },
      // `fields: ["owners"]` — the column is headed "Owner" but the field it
      // WRITES is `owners[]`, the real ownership rows `commit/accounts.ts`
      // persists verbatim. The coarse `owner` enum is deliberately not written:
      // it stays the extractor's record of what the statement said, and it is
      // still the fallback if this set fails tenant validation at commit.
      fields: ["owners"],
      edit: (row, onChange) =>
        createElement(OwnerCellEdit, {
          owners: row.owners,
          hint: row.ownerNameHint,
          subType: row.subType,
          is529: is529Account(row),
          family: ctx.family,
          entities: ctx.entities,
          onDone: (owners: AccountOwner[]) => onChange({ owners }),
        }),
    },
    { key: "custodian", header: "Custodian", kind: "string" },
    {
      key: "accountType",
      header: "Account type",
      kind: "string",
      render: accountTypeLabel,
      // `key` is a synthetic UI grouping, not a real payload field — `fields`
      // names the two real ones this editor writes together (Task 10 review,
      // Important 3). `EntityTable` fans `onChange`'s patch out into one
      // `onEditCell` call per field instead of writing a junk "accountType" key.
      fields: ["category", "subType"],
      edit: (row, onChange) =>
        createElement(AccountTypeCellEdit, {
          category: row.category,
          subType: row.subType,
          onDone: (patch: AccountTypePatch) => onChange(patch),
        }),
    },
    {
      key: "holdings",
      header: "Holdings",
      // `money` would right-align it, but the cell renders its own two-line
      // stack — `number` gets the right alignment without claiming the value
      // is a single figure.
      kind: "number",
      render: (row) => createElement(HoldingsCell, { row }),
    },
    // LAST, after Holdings, so the cell indices the existing table tests pin
    // (Owner at cell 5) keep holding.
    //
    // No `edit`: `MatchColumn` is already its own button-and-popover, so
    // routing it through `EntityTable`'s click-to-edit wrapper would put a
    // button inside a button and cost a second click to reach the picker. It
    // takes `isCommitted` from the table for the same reason an edit cell
    // does — a committed row's link is already written (`linkCreated` stamped
    // it, and `overlayFreshMatch` restores the server's version over any local
    // change), so a live picker there would only ever change the screen.
    {
      key: "match",
      header: "Match",
      kind: "string",
      render: (row, { isCommitted }) => {
        const options = matchCtx?.candidatesByRowId.get(row.__rowId) ?? [];
        const existingId = row.match?.kind === "exact" ? row.match.existingId : null;
        return createElement(MatchColumn, {
          match: row.match,
          // Undefined for an id this page never loaded — the account a
          // completed commit just INSERTED. The badge then says "Matched"
          // without naming a row it cannot name, rather than guessing.
          existingName: existingId
            ? options.find((c) => c.id === existingId)?.name
            : undefined,
          candidates: options,
          entityKind: "account" as const,
          readOnly: isCommitted,
          onChange: matchCtx ? (next: MatchAnnotation) => matchCtx.onPick(row, next) : undefined,
        });
      },
    },
  ];
}
