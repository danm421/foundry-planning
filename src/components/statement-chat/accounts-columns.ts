import { createElement, type ChangeEvent } from "react";
import type { AccountCategory, AccountSubType, ExtractedAccount } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import { CATEGORY_OPTIONS, SUB_TYPE_OPTIONS } from "@/components/import/review-step-accounts";
import { selectClassName } from "@/components/forms/input-styles";
import type { ColumnSpec } from "./entity-table";
import OwnerCell from "./owner-cell";

/**
 * Named `.ts`, not `.tsx`, per the controller amendment's file list — the
 * two `render`/`edit` overrides below build React elements with
 * `createElement` rather than JSX syntax, which a `.ts` file cannot parse
 * (`tsconfig.json`'s `jsx: "react-jsx"` still requires the `.tsx`
 * extension for angle-bracket JSX).
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

function accountTypeLabel(row: Row): string {
  const category = CATEGORY_OPTIONS.find((o) => o.value === row.category)?.label;
  const subType = SUB_TYPE_OPTIONS.find((o) => o.value === row.subType)?.label;
  if (category && subType) return `${category} · ${subType}`;
  return category ?? subType ?? "—";
}

/** The Account type cell's edit view: category + sub-type, the same two
 *  dropdowns `review-step-accounts.tsx` uses, changed together — a
 *  classification change can turn a row into (or out of) a 529, and that
 *  decision needs both values at once, not two independent partial writes. */
function accountTypeEditor(row: Row, onChange: (value: unknown) => void) {
  const emit = (category: AccountCategory | undefined, subType: AccountSubType | undefined) =>
    onChange({ category, subType });

  return createElement(
    "div",
    { className: "flex flex-col gap-1" },
    createElement(
      "select",
      {
        key: "category",
        "aria-label": "Category",
        value: row.category ?? "",
        className: selectClassName,
        onChange: (e: ChangeEvent<HTMLSelectElement>) =>
          emit((e.target.value || undefined) as AccountCategory | undefined, row.subType),
      },
      createElement("option", { key: "", value: "" }, "Select..."),
      ...CATEGORY_OPTIONS.map((o) => createElement("option", { key: o.value, value: o.value }, o.label)),
    ),
    createElement(
      "select",
      {
        key: "subType",
        "aria-label": "Type",
        value: row.subType ?? "",
        className: selectClassName,
        onChange: (e: ChangeEvent<HTMLSelectElement>) =>
          emit(row.category, (e.target.value || undefined) as AccountSubType | undefined),
      },
      createElement("option", { key: "", value: "" }, "Select..."),
      ...SUB_TYPE_OPTIONS.map((o) => createElement("option", { key: o.value, value: o.value }, o.label)),
    ),
  );
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
  },
  { key: "custodian", header: "Custodian", kind: "string" },
  {
    key: "accountType",
    header: "Account type",
    kind: "string",
    render: accountTypeLabel,
    edit: accountTypeEditor,
  },
];
