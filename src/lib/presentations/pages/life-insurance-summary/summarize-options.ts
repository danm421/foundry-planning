// src/lib/presentations/pages/life-insurance-summary/summarize-options.ts
import type { LifeInsuranceSummaryOptions } from "./options-schema";

export function summarizeLifeInsuranceSummaryOptions(
  options: LifeInsuranceSummaryOptions,
): string {
  const model = options.solved?.assumptions.modelPortfolioLabel
    ?? (options.modelPortfolioId ? "model portfolio" : "plan default");
  return `Death ${options.deathYear} · ${model} · ${Math.round(options.mcTargetScore * 100)}%`;
}
