// src/components/reports/widgets/policies-table.tsx
//
// Screen render for the policiesTable widget. Branded table matching the
// polished `balanceSheetTable` treatment: cream/light card, dark header
// row, zebra-striped body rows, hairline separators.
//
// Four columns: Type / Owner / Death Benefit / Annual Premium. Numeric
// columns (death benefit + annual premium) are right-aligned, mono-spaced.
// `deathBenefit` is optional per the prop type (non-life policies omit
// it) — empty cells render as a hairline em dash.
//
// When `rows.length === 0` the widget renders the configured
// `emptyStateMessage` inside a tinted bordered card painted with the
// `report-crit` palette — the empty state is itself a planning signal,
// not just an absence of data.
//
// PDF render lives at `components/reports-pdf/widgets/policies-table.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PoliciesTableRender({
  props,
}: WidgetRenderProps<"policiesTable">) {
  const { title, rows, emptyStateMessage } = props;

  if (rows.length === 0) {
    return (
      <div
        className="bg-report-crit-tint rounded-md border border-report-hair p-4"
        style={{ borderLeft: "3px solid var(--color-report-crit)" }}
        role="note"
      >
        {title && (
          <div className="text-base font-medium text-report-crit mb-1">
            {title}
          </div>
        )}
        <div className="text-sm text-report-crit whitespace-pre-wrap leading-relaxed">
          {emptyStateMessage ?? "No policies on file."}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      {title && (
        <div className="p-4 pb-3">
          <div className="text-base font-medium text-report-ink">{title}</div>
        </div>
      )}
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{title ?? "Policies"}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Type
            </th>
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Owner
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Death Benefit
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Annual Premium
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
            >
              <td className="px-4 py-2 text-report-ink font-medium">
                {row.type}
              </td>
              <td className="px-4 py-2 text-report-ink">{row.owner}</td>
              <td className="px-4 py-2 text-right text-report-ink">
                {row.deathBenefit !== undefined
                  ? FMT.format(row.deathBenefit)
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right text-report-ink">
                {FMT.format(row.annualPremium)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
