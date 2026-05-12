import type { ComparisonTemplate } from "./types";
import { retirementReadinessTemplate } from "./retirement-readiness";
import { rothConversionAnalysisTemplate } from "./roth-conversion-analysis";

export const PRESETS: ComparisonTemplate[] = [
  retirementReadinessTemplate,
  rothConversionAnalysisTemplate,
];

export function findPreset(key: string): ComparisonTemplate | undefined {
  return PRESETS.find((t) => t.key === key);
}

export type { ComparisonTemplate, SlotToken, SlotMapping, TemplateLayoutV5 } from "./types";
export { SLOT_TOKENS, isSlotToken } from "./types";
export { resolveSlots } from "./resolve-slots";
export { extractSlots } from "./extract-slots";
export { cloneComparisonTemplate } from "./clone";
