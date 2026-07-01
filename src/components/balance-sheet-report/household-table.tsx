// src/components/balance-sheet-report/household-table.tsx
import type { HouseholdColumnsModel, OwnerColumns, OwnerColumnRow } from "./household-columns";

const fmt = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface HouseholdTableProps {
  model: HouseholdColumnsModel;
  clientLabel: string;
  spouseLabel: string | null;
}

export default function HouseholdTable({ model, clientLabel, spouseLabel }: HouseholdTableProps) {
  const showSplit = model.hasSpouse && spouseLabel != null;
  // Columns: Client [Spouse Joint] Total. Single-client households hide Spouse + Joint.
  const cell = (v: number) => <td className="px-3 py-1.5 text-right tabular-nums text-ink">{fmt(v)}</td>;
  const cols = (c: OwnerColumns) => (
    <>
      {cell(c.client)}
      {showSplit && cell(c.spouse)}
      {showSplit && cell(c.joint)}
      {cell(c.total)}
    </>
  );
  const negCols = (c: OwnerColumns) => {
    const neg = (v: number) => (
      <td className="px-3 py-1.5 text-right tabular-nums text-crit">{v === 0 ? "—" : `(${fmt(v)})`}</td>
    );
    return (
      <>
        {neg(c.client)}
        {showSplit && neg(c.spouse)}
        {showSplit && neg(c.joint)}
        {neg(c.total)}
      </>
    );
  };
  const nwCell = (v: number) => (
    <td className={`px-3 py-2 text-right tabular-nums ${v < 0 ? "text-crit" : "text-good"}`}>{fmt(v)}</td>
  );
  const nwCols = (c: OwnerColumns) => (
    <>
      {nwCell(c.client)}
      {showSplit && nwCell(c.spouse)}
      {showSplit && nwCell(c.joint)}
      {nwCell(c.total)}
    </>
  );

  const rowEl = (r: OwnerColumnRow, negative = false) => (
    <tr key={r.key} className="border-t border-hair">
      <td className="px-3 py-1.5 pl-6 text-ink-2">
        {r.name}
        {r.hasLinkedMortgage && <span className="ml-1 text-[10px] text-ink-4">(M)</span>}
        {r.revocableTrustName && (
          <span className="ml-2 rounded bg-data-teal/15 px-1.5 py-0.5 text-[10px] font-medium text-data-teal">
            {r.revocableTrustName}
          </span>
        )}
      </td>
      {negative ? negCols(r) : cols(r)}
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-medium">Category / Account</th>
            <th className="px-3 py-2 text-right font-medium">{clientLabel}</th>
            {showSplit && <th className="px-3 py-2 text-right font-medium">{spouseLabel}</th>}
            {showSplit && <th className="px-3 py-2 text-right font-medium">Joint</th>}
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {model.assetCategories.map((cat) => (
            <CategoryBlock key={cat.key} cat={cat} cols={cols} rowEl={rowEl} />
          ))}
          <tr className="border-t-2 border-hair-2 bg-paper font-semibold text-ink">
            <td className="px-3 py-2">Total Assets</td>
            {cols(model.totalAssets)}
          </tr>
          {model.liabilityRows.length > 0 && (
            <>
              <tr className="border-t border-hair">
                <td className="px-3 py-2 text-base font-semibold text-accent-ink" colSpan={showSplit ? 5 : 3}>Liabilities</td>
              </tr>
              {model.liabilityRows.map((r) => rowEl(r, true))}
            </>
          )}
          <tr className="border-t-2 border-hair-2 bg-paper font-semibold text-crit">
            <td className="px-3 py-2">Total Liabilities</td>
            {negCols(model.totalLiabilities)}
          </tr>
          <tr className="border-t-2 border-hair-2 bg-paper font-semibold">
            <td className="px-3 py-2 text-ink">Net Worth</td>
            {nwCols(model.netWorth)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CategoryBlock({
  cat,
  cols,
  rowEl,
}: {
  cat: HouseholdColumnsModel["assetCategories"][number];
  cols: (c: OwnerColumns) => React.ReactNode;
  rowEl: (r: OwnerColumnRow) => React.ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-hair">
        <td className="px-3 py-2 text-base font-semibold text-accent-ink">{cat.label}</td>
        {cols(cat)}
      </tr>
      {cat.rows.map((r) => rowEl(r))}
    </>
  );
}
