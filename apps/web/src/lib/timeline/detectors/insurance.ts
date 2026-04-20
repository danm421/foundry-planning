// src/lib/timeline/detectors/insurance.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function detectInsuranceEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const lifeAccounts = data.accounts.filter((a) => a.category === "life_insurance");
  if (lifeAccounts.length === 0) return out;

  const seen = new Set<string>();
  for (const py of projection) {
    for (const acct of lifeAccounts) {
      if (seen.has(acct.id)) continue;
      const ledger = py.accountLedgers[acct.id];
      if (!ledger) continue;
      // Heuristic: distributions > 0 OR a sharp drop to zero in ending value indicates proceeds.
      const distributedOut = ledger.distributions > 0;
      const zeroed = ledger.endingValue === 0 && ledger.beginningValue > 0;
      if (distributedOut || zeroed) {
        seen.add(acct.id);
        const amount = ledger.distributions > 0 ? ledger.distributions : ledger.beginningValue;
        out.push({
          id: `insurance:proceeds:${acct.id}`,
          year: py.year,
          category: "insurance",
          subject: "joint",
          title: "Life insurance proceeds",
          supportingFigure: `${currency(amount)} paid`,
          details: [
            { label: "Policy", value: acct.name },
            { label: "Proceeds", value: currency(amount) },
          ],
        });
      }
    }
  }

  return out;
}
