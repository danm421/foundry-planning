// src/components/reports/widgets/balance-sheet-table.tsx
//
// Screen render for the balanceSheetTable widget. Reuses the existing
// `BalanceSheetViewModel` produced by `buildViewModel` in the data-loader
// (no separate scope; the route bridges `apiData.accounts/liabilities/
// entities` and passes them through ctx).
//
// V1 scope: category totals + grand totals only. The `showEntityBreakdown`
// prop is wired in defaults but the screen render keeps it simple — entity
// breakdown rendering is intentionally deferred (see future-work/reports.md).
//
// Visual treatment matches the Ethos comparison redesign branded table:
// - Cream/light card (`bg-report-card` + `border-report-hair`) so the
//   builder canvas reads the same as the printed PDF.
// - Subsection-styled title (Fraunces 14pt / `text-base font-medium`).
// - Dark header row (`bg-report-ink-deep` / `text-report-ink-on-dark`)
//   with mono uppercase column labels.
// - Zebra rows alternating `bg-report-card` / `bg-report-zebra`,
//   hairline separators, right-aligned numeric cells.
// - 1.5px accent separator above the "Net worth" totals row; bold value
//   colored `report-good` when positive, `report-crit` when negative.
//
// PDF render lives at `components/reports-pdf/widgets/balance-sheet-table.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/balance-sheet-table.pdf.ts`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { BalanceSheetViewModel } from "@/components/balance-sheet-report/view-model";

const FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function BalanceSheetTableRender(
  p: WidgetRenderProps<"balanceSheetTable">,
) {
  const vm = p.data as BalanceSheetViewModel | undefined;
  if (!vm) {
    // Builder UI doesn't run the data-loader; widget data is only present at
    // export time. Show a graceful empty state in the on-screen builder.
    return (
      <div className="p-4 bg-report-card rounded-md border border-report-hair">
        <div className="text-base font-medium text-report-ink mb-2">
          {p.props.title}
        </div>
        <div className="text-xs text-report-ink-3">
          No data available — preview shown only at export.
        </div>
      </div>
    );
  }
  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      <div className="p-4 pb-3">
        <div className="text-base font-medium text-report-ink">
          {p.props.title}
        </div>
        {p.props.subtitle && (
          <div className="text-xs text-report-ink-3 mt-1">
            {p.props.subtitle}
          </div>
        )}
      </div>
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{p.props.title}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Category
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {vm.assetCategories.map((cat, i) => (
            <tr
              key={cat.key}
              className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
            >
              <td className="px-4 py-2 text-report-ink">{cat.label}</td>
              <td className="px-4 py-2 text-right text-report-ink">
                {FMT.format(cat.total)}
              </td>
            </tr>
          ))}
          <tr
            className={`${vm.assetCategories.length % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair font-medium`}
          >
            <td className="px-4 py-2 text-report-ink">Total assets</td>
            <td className="px-4 py-2 text-right text-report-ink">
              {FMT.format(vm.totalAssets)}
            </td>
          </tr>
          <tr
            className={`${(vm.assetCategories.length + 1) % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
          >
            <td className="px-4 py-2 text-report-ink">Total liabilities</td>
            <td className="px-4 py-2 text-right text-report-ink">
              {FMT.format(vm.totalLiabilities)}
            </td>
          </tr>
          <tr
            className="bg-report-card font-medium"
            style={{ borderTop: "1.5px solid var(--color-report-accent)" }}
          >
            <td className="px-4 py-2.5 text-report-ink">Net worth</td>
            <td
              className={`px-4 py-2.5 text-right font-medium ${
                vm.netWorth >= 0 ? "text-report-good" : "text-report-crit"
              }`}
            >
              {FMT.format(vm.netWorth)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
