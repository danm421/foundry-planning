import { z } from "zod";
export const portfolioAnalysisOptionsSchema = z.object({
  /** Entity keys ("type:id"). Empty = use defaultAnalysisSelection at build time. */
  selectedKeys: z.array(z.string()),
  sortKey: z.enum(["name", "return", "mean", "stdDev", "sharpe", "value"]),
  sortDir: z.enum(["asc", "desc"]),
});
export type PortfolioAnalysisOptions = z.infer<typeof portfolioAnalysisOptionsSchema>;
export const PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT: PortfolioAnalysisOptions = {
  selectedKeys: [], sortKey: "stdDev", sortDir: "asc",
};
