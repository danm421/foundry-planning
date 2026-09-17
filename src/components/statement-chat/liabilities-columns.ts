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
 * Annualized escrow for display: what `splitMortgageEscrow` will move onto
 * the secured property as `annualPropertyTax`, or undefined.
 *
 * Delegates to `annualEscrow` (`mortgage-escrow.ts`) rather than
 * re-implementing the arithmetic: this column is headed "Escrow → property
 * tax", promising the advisor the figure the import will actually write onto
 * the property, and two copies of that computation could drift. Delegating
 * still counts as RE-DERIVED for the reason this column exists — it computes
 * from the liability's own fields, not by reading the answer back off the
 * property row `splitMortgageEscrow` writes, which would make the two agree
 * by construction even when the split never ran.
 */
export function escrowAnnual(row: Row): number | undefined {
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
      key: "totalPayment",
      header: "Escrow → property tax",
      kind: "money",
      render: (row) => {
        const annual = escrowAnnual(row);
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
