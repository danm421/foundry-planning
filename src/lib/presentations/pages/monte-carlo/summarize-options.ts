import type { MonteCarloPageOptions } from "./options-schema";

const LABELS: Record<MonteCarloPageOptions["highlight"], string> = {
  fan: "Fan chart",
  histogram: "Ending distribution",
  longevity: "Success over time",
};

export function summarizeMonteCarloOptions(options: MonteCarloPageOptions): string {
  return `Highlight: ${LABELS[options.highlight]}`;
}
