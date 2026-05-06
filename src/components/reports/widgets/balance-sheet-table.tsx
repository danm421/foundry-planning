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
      <div className="p-4 bg-card-2 rounded-md border border-hair">
        <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
        <div className="text-[12px] text-ink-3">
          No data available — preview shown only at export.
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <table className="w-full text-[12px] font-mono">
        <caption className="sr-only">{p.props.title}</caption>
        <tbody>
          {vm.assetCategories.map((cat) => (
            <tr key={cat.key} className="border-t border-hair">
              <td className="py-1">{cat.label}</td>
              <td className="text-right">{FMT.format(cat.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink font-medium">
            <td className="py-1">Total assets</td>
            <td className="text-right">{FMT.format(vm.totalAssets)}</td>
          </tr>
          <tr className="border-t border-hair">
            <td className="py-1">Total liabilities</td>
            <td className="text-right">{FMT.format(vm.totalLiabilities)}</td>
          </tr>
          <tr className="border-t-2 border-ink font-medium">
            <td className="py-1">Net worth</td>
            <td
              className={`text-right ${vm.netWorth >= 0 ? "text-good" : "text-crit"}`}
            >
              {FMT.format(vm.netWorth)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
