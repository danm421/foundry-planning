import type { BracketCellDrillArgs, CellDrillProps, CellDrillRow } from "./types";
import { formatCurrency } from "./_shared";

export function buildConversionCellDrill(args: BracketCellDrillArgs): CellDrillProps {
  const { year, columnKey } = args;
  if (columnKey !== "conversionGross" && columnKey !== "conversionTaxable") {
    throw new Error(`bracket-conversions adapter only handles conversion columns; got ${columnKey}`);
  }
  const conversions = year.rothConversions ?? [];
  const isGross = columnKey === "conversionGross";
  const title = isGross
    ? `Roth Conversion (Gross) — ${year.year}`
    : `Roth Conversion (Taxable) — ${year.year}`;

  const rows: CellDrillRow[] = conversions.map((c) => ({
    id: c.id,
    label: c.name,
    amount: isGross ? c.gross : c.taxable,
    meta: isGross
      ? `${formatCurrency(c.taxable)} taxable`
      : `${formatCurrency(c.gross)} gross`,
  }));

  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { title, total, groups: [{ rows }] };
}
