import { z } from "zod";

export const MONTE_CARLO_CHART_KINDS = ["fan", "histogram", "longevity"] as const;
export type MonteCarloChartKind = (typeof MONTE_CARLO_CHART_KINDS)[number];

export const monteCarloOptionsSchema = z.object({
  highlight: z.enum(MONTE_CARLO_CHART_KINDS),
});

export type MonteCarloPageOptions = z.infer<typeof monteCarloOptionsSchema>;

export const MONTE_CARLO_OPTIONS_DEFAULT: MonteCarloPageOptions = {
  highlight: "fan",
};
