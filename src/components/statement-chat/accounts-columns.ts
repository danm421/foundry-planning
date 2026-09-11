import { createElement } from "react";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { formatAccountCategory, formatAccountSubType } from "@/lib/accounts/category-labels";
import type { ColumnSpec } from "./entity-table";
import OwnerCell from "./owner-cell";
import OwnerCellEdit, { type OwnerRole } from "./owner-cell-edit";
import AccountTypeCellEdit, { type AccountTypePatch } from "./account-type-cell";

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
 * A resolved owner entry carries a display `name` once ownership matching
 * has run — `AccountOwner` (the persisted shape) does not declare that
 * field today, so this reads it defensively rather than assuming the shape.
 */
function resolvedOwnerNames(owners: Row["owners"]): string[] | undefined {
  if (!owners || owners.length === 0) return undefined;
  const names = owners
    .map((o) => (o && typeof o === "object" && "name" in o ? (o as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * Display label for the collapsed Account-type cell. Uses the canonical
 * `formatAccountCategory`/`formatAccountSubType` formatters (Task 10 review,
 * Important 9) rather than re-deriving labels by scanning the dropdown
 * option list — that list is curated for the SELECT control, not display,
 * and duplicating a lookup that already exists elsewhere is exactly what
 * `src/lib/accounts/category-labels.ts` was built to prevent.
 */
export function accountTypeLabel(row: Row): string {
  const category = row.category ? formatAccountCategory(row.category) : undefined;
  const subType = row.subType ? formatAccountSubType(row.subType) : undefined;
  if (category && subType) return `${category} · ${subType}`;
  return category ?? subType ?? "—";
}

/** The seven-column spec (Name · Value · Basis · Last 4 · Owner · Custodian
 *  · Account type), unchanged from the original single-file task. */
export const ACCOUNT_COLUMNS: ColumnSpec<Row>[] = [
  { key: "name", header: "Name", kind: "string" },
  { key: "value", header: "Value", kind: "money" },
  { key: "basis", header: "Basis", kind: "money" },
  {
    key: "accountNumberLast4",
    header: "Last 4",
    kind: "string",
    // IDs are mono per the design system, independent of alignment.
    render: (row) => (row.accountNumberLast4 ? createElement("span", { className: "tabular" }, row.accountNumberLast4) : "—"),
  },
  {
    key: "owner",
    header: "Owner",
    kind: "string",
    render: (row) =>
      createElement(OwnerCell, {
        names: resolvedOwnerNames(row.owners),
        hint: row.ownerNameHint,
        role: row.owner,
      }),
    // ONE real field, so the plain single-value path — no `fields: [...]`
    // fan-out (that exists for the multi-field Account-type editor, and
    // here it would only write the same key twice). `owner` is already on
    // `EDITABLE_ACCOUNT_FIELDS`, so `useChatCommit`'s existing
    // `handleEditCell` -> `flushRowsToServer` carries the write; no new
    // route and no schema change (Task 12, requirement B).
    edit: (row, onChange) =>
      createElement(OwnerCellEdit, {
        owner: row.owner,
        hint: row.ownerNameHint,
        onDone: (owner: OwnerRole) => onChange(owner),
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
];
