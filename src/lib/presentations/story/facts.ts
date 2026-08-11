// The single place a client-facing figure becomes a string. The model is
// handed `display` values and is forbidden from formatting anything itself,
// so rounding rules cannot drift between two chapters of the same report.
import { fmtUsdCompact } from "@/lib/presentations/pages/retirement-comparison/format";

export interface Fact {
  /** Stable dotted id, e.g. "outcome.confidence.proposed". */
  id: string;
  /** Human label shown to the advisor in the review panel. */
  label: string;
  /** Pre-formatted, client-ready string. The only form the model ever sees. */
  display: string;
  raw: number;
}

export function moneyFact(id: string, label: string, raw: number): Fact {
  return { id, label, display: fmtUsdCompact(raw), raw };
}

/** `raw` is a fraction: 0.91 → "91%". At most one decimal, no trailing ".0". */
export function pctFact(id: string, label: string, raw: number): Fact {
  const pct = raw * 100;
  const display = `${Number.isInteger(pct) ? pct : Number(pct.toFixed(1))}%`;
  return { id, label, display, raw };
}

export function yearFact(id: string, label: string, raw: number): Fact {
  return { id, label, display: String(Math.round(raw)), raw };
}

export function factDisplaySet(facts: Fact[]): Set<string> {
  return new Set(facts.map((f) => f.display));
}
