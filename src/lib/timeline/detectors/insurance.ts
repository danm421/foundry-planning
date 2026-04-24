// src/lib/timeline/detectors/insurance.ts
import type { ClientData, ProjectionYear } from "@/engine";
import { computeTermEndYear } from "@/engine/life-insurance-expiry";
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
        const policy = acct.lifeInsurance;
        const amount = policy?.faceValue
          ?? (ledger.distributions > 0 ? ledger.distributions : ledger.beginningValue);
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

  // Second pass: emit "Term insurance expired" the year after a term policy's
  // last in-force year, when the projection covers that year.
  for (const acct of lifeAccounts) {
    const policy = acct.lifeInsurance;
    if (!policy) continue;
    if (policy.policyType !== "term") continue;
    const insured = (acct.insuredPerson ?? "client") as "client" | "spouse" | "joint";
    const endYear = computeTermEndYear({ policy, insured, client: data.client });
    if (endYear == null) continue;
    const expiryYear = endYear + 1;
    const py = projection.find((p) => p.year === expiryYear);
    if (!py) continue;
    out.push({
      id: `insurance:term_expired:${acct.id}`,
      year: expiryYear,
      category: "insurance",
      subject: "joint",
      title: "Term insurance expired",
      supportingFigure: `${currency(policy.faceValue)} coverage ended`,
      details: [
        { label: "Policy", value: acct.name },
        { label: "Term end year", value: String(endYear) },
      ],
    });
  }

  return out;
}
