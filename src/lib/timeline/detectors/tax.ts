import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/**
 * Pull the top federal marginal ordinary-income rate encountered this year from the
 * engine's TaxResult. The engine exposes a bracket walk on taxResult; for v1 we look
 * for a numeric marginalRate field and fall back to topBracketRate, matching how
 * other UI components read the same structure. If neither exists, tax-bracket events
 * are simply suppressed.
 */
function topOrdinaryRate(py: ProjectionYear): number | null {
  const tr = py.taxResult as unknown as { marginalRate?: number; topBracketRate?: number } | undefined;
  if (!tr) return null;
  if (typeof tr.marginalRate === "number") return tr.marginalRate;
  if (typeof tr.topBracketRate === "number") return tr.topBracketRate;
  return null;
}

export function detectTaxEvents(
  _data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  let prevRate: number | null = null;

  // Bracket changes — one event per year where the rate changes from the previous year.
  for (const py of projection) {
    const rate = topOrdinaryRate(py);
    if (rate != null && prevRate != null && rate !== prevRate) {
      out.push({
        id: `tax:bracket_change:${py.year}`,
        year: py.year,
        category: "tax",
        subject: "joint",
        title: "Federal bracket change",
        supportingFigure: `Top ordinary rate: ${(rate * 100).toFixed(1)}%`,
        details: [
          { label: "Previous rate", value: `${(prevRate * 100).toFixed(1)}%` },
          { label: "New rate", value: `${(rate * 100).toFixed(1)}%` },
        ],
      });
    }
    if (rate != null) prevRate = rate;
  }

  // First negative cash flow year.
  const firstNeg = projection.find((py) => py.netCashFlow < 0);
  if (firstNeg) {
    out.push({
      id: "tax:first_negative_cashflow",
      year: firstNeg.year,
      category: "tax",
      subject: "joint",
      title: "Cash flow turns negative",
      supportingFigure: `${currency(firstNeg.netCashFlow)} this year`,
      details: [
        { label: "Net cash flow", value: currency(firstNeg.netCashFlow) },
        { label: "Total income", value: currency(firstNeg.totalIncome) },
        { label: "Total expenses", value: currency(firstNeg.totalExpenses) },
      ],
    });
  }

  return out;
}
