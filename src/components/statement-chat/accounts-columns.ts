import { createElement } from "react";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
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
import type { ColumnSpec } from "./entity-table";
import OwnerCell from "./owner-cell";
import OwnerCellEdit from "./owner-cell-edit";
import AccountTypeCellEdit, {
  type AccountTypePatch,
} from "./account-type-cell";
import { HoldingsCell } from "./holdings-cell";

/**
 * Named `.ts`, not `.tsx`, per the controller amendment's file list. The
 * two `render` overrides below build React elements with `createElement`
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
 * What the column spec needs to know about the plan the import commits into.
 * Empty is legal and degrades honestly — the Owner cell falls back to the
 * printed registration name, exactly as it behaved before the roster existed.
 */
export interface AccountColumnsContext {
  family: OwnerMatchFamilyMember[];
  entities: OwnerEntityOption[];
}

export const EMPTY_ACCOUNT_COLUMNS_CONTEXT: AccountColumnsContext = {
  family: [],
  entities: [],
};

/**
 * The eight-column spec (Name · Value · Basis · Last 4 · Owner · Custodian
 * · Account type · Holdings).
 *
 * A factory rather than a constant since the Owner column has to resolve ids
 * against THIS client's roster. Everything else is context-free and unchanged.
 */
export function accountColumns(ctx: AccountColumnsContext): ColumnSpec<Row>[] {
  return [
    { key: "name", header: "Name", kind: "string" },
    { key: "value", header: "Value", kind: "money" },
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
  ];
}
