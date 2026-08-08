// Adapter over the tax-analysis observation layer. It MAPS; it never
// re-derives a figure. When the tax findings layer lands (see
// plans/2026-08-08-tax-analysis-findings-layer), `Observation` becomes
// `Finding` with a four-part body and its own estimatedImpact, and this file
// is the ONLY consumer outside src/lib/tax-analysis/ that has to change.
import type { Observation } from "@/lib/tax-analysis/types";
import type { Signal, SignalInput } from "./types";

/**
 * The one number that best represents each observation's size, used for
 * ordering. Absent from an observation's `numbers` → null → sorts last.
 * Superseded by the tax layer's own estimatedImpact after the rename.
 */
const IMPACT_KEY: Record<string, string> = {
  "roth-headroom": "headroom",
  "ltcg-zero-headroom": "zeroPctHeadroom",
  "capital-loss-carryover": "carryover",
  "niit-exposure": "estTax",
  "additional-medicare": "estTax",
  "safe-harbor": "shortfall",
  "irmaa-cliff": "distanceToNextCliff",
  "charitable-bunching": "shortfall",
};

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

  return tax.observations.map((o: Observation) => {
    const key = IMPACT_KEY[o.id];
    const impact = key != null ? o.numbers[key] : undefined;
    return {
      id: `tax.${o.id}`,
      domain: "tax" as const,
      // opportunity | watch | info map 1:1; the tax layer never emits critical.
      severity: o.severity,
      title: o.title,
      detail: o.body,
      numbers: o.numbers,
      href: `/clients/${clientId}/details/tax-analysis?year=${tax.taxYear}`,
      estimatedImpact: typeof impact === "number" ? impact : null,
    };
  });
}
