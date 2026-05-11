import type { ComparisonLayout, ComparisonWidgetKind } from "../layout-schema";

const DEFAULT_KINDS: ComparisonWidgetKind[] = [
  "kpi-strip",
  "portfolio",
  "monte-carlo",
  "longevity",
  "lifetime-tax",
  "liquidity",
  "estate-impact",
  "estate-tax",
];

export function getDefaultLayout(): ComparisonLayout {
  return {
    version: 1,
    items: DEFAULT_KINDS.map((kind) => ({
      instanceId: crypto.randomUUID(),
      kind,
      hidden: false,
      collapsed: false,
    })),
  };
}
