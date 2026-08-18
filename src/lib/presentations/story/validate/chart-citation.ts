// Gate 8 — the chapter's prose must name at least one figure from the chart
// printed above it.
//
// This is the gate that separates "a chart with prose beside it" from "prose
// about a chart". Gate 1 already guarantees every figure in the draft is one we
// supplied; it cannot ask whether the draft engaged with the PICTURE, because a
// plan-level total grounds just as well as a charted one.
//
// ⚠️ ONE figure, not all of them. A `chartWithProse` chapter is two short
// paragraphs; requiring every charted figure would make this gate unsatisfiable
// inside its own word budget and turn the single retry into the normal path.
// Raising the bar means re-measuring the budget first.
import { type Fact } from "../facts";
import { citesFigure } from "./facts";
import type { GateFailure } from "./types";

/** The prefix `build-facts.ts#chartFacts` gives every figure a chart draws. */
const CHART_FACT_PREFIX = "chart.";

export function chartCitationGate(markdown: string, facts: Fact[]): GateFailure[] {
  const charted = facts.filter((f) => f.id.startsWith(CHART_FACT_PREFIX));
  // No chart on this chapter — nothing to cite, and nothing to complain about.
  // This is the whole no-data path: a household with no estate report reaches
  // here with an empty list, and its draft must not be rejected for it.
  if (charted.length === 0) return [];
  if (charted.some((f) => citesFigure(markdown, f.display))) return [];
  return [
    {
      gate: "chartCitation",
      // Names the figures rather than the rule, because this message is reused
      // verbatim in the single retry prompt and the model has to know WHICH
      // numbers would satisfy it.
      message: `The text has to explain the chart printed with it. Name at least one of these figures from that chart: ${charted
        .map((f) => f.display)
        .join(", ")}.`,
    },
  ];
}
