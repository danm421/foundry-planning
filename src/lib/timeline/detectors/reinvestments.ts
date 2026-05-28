import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectReinvestmentEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const accountNameById = new Map<string, string>();
  for (const a of data.accounts ?? []) accountNameById.set(a.id, a.name);

  const projectionByYear = new Map<number, ProjectionYear>();
  for (const py of projection) projectionByYear.set(py.year, py);

  for (const r of data.reinvestments ?? []) {
    if (!inRange(r.year, projection)) continue;

    const prevPy = projectionByYear.get(r.year - 1);
    let totalSwitched = 0;
    let balanceLookupWorked = false;
    if (prevPy) {
      for (const acctId of r.accountIds ?? []) {
        const fraction = r.soldFractionByAccount?.[acctId] ?? 0;
        const endingValue = prevPy.accountLedgers?.[acctId]?.endingValue;
        if (typeof endingValue === "number" && fraction > 0) {
          totalSwitched += endingValue * fraction;
          balanceLookupWorked = true;
        }
      }
    }

    const supportingFigure =
      balanceLookupWorked && totalSwitched > 0
        ? `${currency(totalSwitched)} reinvested`
        : `New growth rate ${pct(r.newGrowthRate)}`;

    const details: TimelineEventDetail[] = [
      { label: "New growth rate", value: pct(r.newGrowthRate) },
      { label: "Taxes realized on switch", value: r.realizeTaxesOnSwitch ? "Yes" : "No" },
    ];
    const accountNames = (r.accountIds ?? [])
      .map((id) => accountNameById.get(id) ?? id)
      .join(", ");
    if (accountNames) details.push({ label: "Accounts", value: accountNames });
    if (balanceLookupWorked && totalSwitched > 0) {
      details.push({ label: "Amount reinvested", value: currency(totalSwitched) });
    }

    out.push({
      id: `strategy:reinvestment:${r.id}`,
      year: r.year,
      category: "strategy",
      subject: "joint",
      title: r.name,
      supportingFigure,
      details,
    });
  }

  return out;
}
