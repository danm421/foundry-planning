// Adapter over the tax-analysis findings layer. It MAPS; it never re-derives a
// figure. The findings layer landed (plans/2026-08-08-tax-analysis-findings-layer)
// and this file was, as predicted, the only consumer outside src/lib/tax-analysis/
// that had to change: `Observation` became `Finding` with a four-part body, and
// the local IMPACT_KEY lookup that used to guess each observation's headline
// figure is gone — every builder now publishes its own `estimatedImpact`.
import type { Finding } from "@/lib/tax-analysis/types";
import type { Signal, SignalInput } from "./types";

export function taxSignals(input: SignalInput): Signal[] {
  const { tax, clientId } = input;

  if (tax.taxYear === null) {
    return [
      {
        id: "tax.no_return_on_file",
        domain: "tax",
        severity: "info",
        title: "No tax return on file",
        detail:
          "No filed return has been uploaded, so none of the return-driven tax findings can run for this household.",
        numbers: {},
        href: `/clients/${clientId}/details/tax-analysis`,
        estimatedImpact: null,
      },
    ];
  }

  return tax.findings.map((f: Finding) => ({
    id: `tax.${f.id}`,
    domain: "tax" as const,
    // opportunity | watch | info map 1:1; the tax layer never emits critical.
    severity: f.severity,
    title: f.headline,
    // The four-part body's first part is the evidence sentence — the figures,
    // sourced — which is what a 360 card needs. `whyItMatters` is the mechanism
    // and `whatToConsider` the action; both belong on the tax tab, not here.
    detail: f.whatTheReturnShows,
    numbers: f.numbers,
    href: `/clients/${clientId}/details/tax-analysis?year=${tax.taxYear}`,
    estimatedImpact: f.estimatedImpact,
  }));
}
