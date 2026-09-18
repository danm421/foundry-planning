import { createElement } from "react";
import type { ExtractedLiability } from "@/lib/extraction/types";
import type { Annotated, MatchAnnotation } from "@/lib/imports/types";
import { annualEscrow } from "@/lib/imports/assemble/mortgage-escrow";
import MatchColumn from "@/components/import/match-column";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import { formatValue, type ColumnSpec } from "./entity-table";

/**
 * Named `.ts`, not `.tsx`, for the same reason `accounts-columns.ts` is: the
 * `render` overrides build elements with `createElement` rather than JSX
 * syntax, which a `.ts` file cannot parse.
 */

type Row = Annotated<ExtractedLiability>;

/** The Match column's table-level wiring — see `AccountMatchContext`. */
export interface LiabilityMatchContext {
  candidatesByRowId: ReadonlyMap<string | undefined, MatchCandidate[]>;
  onPick: (row: Row, next: MatchAnnotation) => void;
}

export interface LiabilityColumnsContext {
  match?: LiabilityMatchContext;
}

export const EMPTY_LIABILITY_COLUMNS_CONTEXT: LiabilityColumnsContext = {};

/**
 * The annualized escrow this cell prints: what the import will write onto the
 * secured property as `annualPropertyTax`, or undefined.
 *
 * Named for the CELL, not for the arithmetic (final review M6): `annualEscrow`
 * in `mortgage-escrow.ts` is a transposition of the old name that returns a
 * different shape (`{annual?, warning?}`), and the two sat one import apart.
 *
 * Delegates to `annualEscrow` rather than re-implementing the arithmetic:
 * two copies of that computation could drift. Delegating still counts as
 * RE-DERIVED for the reason this column exists — it computes from the
 * liability's own fields, not by reading the answer back off the property row
 * `splitMortgageEscrow` writes, which would make the two agree by construction
 * even when the split never ran.
 *
 * The promise this docblock used to make — "the figure the import will
 * actually write" — is now true rather than aspirational: correcting P&I or
 * the total payment in the chat moves the property's stored
 * `annualPropertyTax` with it (`tools.ts`'s `syncDerivedPropertyTax`, final
 * review I3). It stays honest in the one case that fix deliberately excludes:
 * a tax the DOCUMENT asserted is left alone, and this cell then shows the
 * derivation rather than the stored figure.
 */
export function escrowCellValue(row: Row): number | undefined {
  return annualEscrow(row).annual;
}

export function liabilityColumns(ctx: LiabilityColumnsContext): ColumnSpec<Row>[] {
  const matchCtx = ctx.match;
  return [
    { key: "name", header: "Name", kind: "string" },
    // `total` on Balance alone: what the household owes is the figure an
    // advisor reconciles against the statements in hand. Summing rates or
    // payments answers a question nobody asked.
    { key: "balance", header: "Balance", kind: "money", total: true },
    { key: "balanceAsOfDate", header: "As of", kind: "date" },
    { key: "maturityDate", header: "Matures", kind: "date" },
    { key: "interestRate", header: "Rate", kind: "rate" },
    { key: "monthlyPayment", header: "P&I", kind: "money" },
    {
      // The header says what the number IS, not what the statement printed:
      // the figure shown is the escrow this import will write onto the
      // property as annual property tax, and the raw PITI sits under it as
      // the evidence. A column headed "Total payment" showing an annual
      // figure would be a third thing neither of them.
      //
      // "will write" is load-bearing and now holds on the edit path too — see
      // `escrowCellValue` — except where the document asserted a property tax
      // of its own, which the import keeps.
      key: "totalPayment",
      header: "Escrow → property tax",
      kind: "money",
      render: (row) => {
        const annual = escrowCellValue(row);
        if (annual === undefined) {
          return row.totalPayment != null
            ? createElement(
                "span",
                { className: "text-ink-3" },
                `${formatValue("money", row.totalPayment)}/mo total`,
              )
            : "—";
        }
        return createElement(
          "span",
          { className: "flex flex-col items-end" },
          createElement("span", { key: "a" }, `${formatValue("money", annual)}/yr`),
          createElement(
            "span",
            { key: "b", className: "text-xs text-ink-3" },
            `${formatValue("money", row.totalPayment!)}/mo PITI`,
          ),
        );
      },
    },
    { key: "propertyAddress", header: "Property", kind: "string" },
    {
      key: "match",
      header: "Match",
      kind: "string",
      render: (row, { isCommitted }) => {
        const options = matchCtx?.candidatesByRowId.get(row.__rowId) ?? [];
        const existingId = row.match?.kind === "exact" ? row.match.existingId : null;
        return createElement(MatchColumn, {
          match: row.match,
          existingName: existingId
            ? options.find((c) => c.id === existingId)?.name
            : undefined,
          candidates: options,
          entityKind: "liability" as const,
          readOnly: isCommitted,
          onChange: matchCtx ? (next: MatchAnnotation) => matchCtx.onPick(row, next) : undefined,
        });
      },
    },
  ];
}
