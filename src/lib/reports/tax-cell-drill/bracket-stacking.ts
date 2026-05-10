import type {
  BracketCellDrillArgs,
  CellDrillProps,
  CellDrillRow,
} from "./types";
import { formatCurrency, resolveSourceLabel } from "./_shared";

const ORDINARY_STACK_TYPES = new Set(["earned_income", "ordinary_income", "stcg"]);

export function buildBracketStackCellDrill(args: BracketCellDrillArgs): CellDrillProps {
  const { year, columnKey, ctx } = args;
  if (columnKey !== "intoBracket") {
    throw new Error(`bracket-stacking adapter only handles intoBracket; got ${columnKey}`);
  }
  const title = `Amount Into Federal Marginal Bracket — ${year.year}`;
  const tier = year.taxResult?.diag.marginalBracketTier;
  const incomeTaxBase = year.taxResult?.flow.incomeTaxBase ?? 0;
  if (!tier) {
    return { title, total: 0, groups: [{ rows: [] }] };
  }
  const total = Math.max(0, incomeTaxBase - tier.from);

  if (total === 0) {
    return { title, total, groups: [{ rows: [] }] };
  }

  const bySource = year.taxDetail?.bySource ?? {};
  const rows: CellDrillRow[] = Object.entries(bySource)
    .filter(([, v]) => ORDINARY_STACK_TYPES.has(v.type))
    .map(([id, v]) => ({ id, label: resolveSourceLabel(id, ctx), amount: v.amount }))
    .sort((a, b) => b.amount - a.amount);

  // Find boundary: first index where running total > tier.from.
  let running = 0;
  let boundaryIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const next = running + rows[i].amount;
    if (next > tier.from) {
      boundaryIndex = i;
      // Split annotation on the boundary row.
      const inLower = Math.max(0, tier.from - running);
      const inThis = rows[i].amount - inLower;
      rows[i] = {
        ...rows[i],
        meta: `${formatCurrency(inLower)} in lower bracket / ${formatCurrency(inThis)} in this bracket`,
      };
      break;
    }
    running = next;
  }

  return {
    title,
    subtitle: `Marginal bracket: ${(tier.rate * 100).toFixed(0)}% (from ${formatCurrency(tier.from)}${tier.to == null ? "+" : ` to ${formatCurrency(tier.to)}`})`,
    total,
    groups: [{ rows, boundaryIndex }],
    footnote: "Stacking order is illustrative; bracket math applies to totals, not individual items.",
  };
}
