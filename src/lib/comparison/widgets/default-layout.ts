import type { ComparisonLayout, ComparisonWidgetKind } from "../layout-schema";
import { WIDGET_KINDS } from "../layout-schema";

const DEFAULT_KINDS: readonly ComparisonWidgetKind[] = WIDGET_KINDS.filter(
  (k) => k !== "text",
);

export function getDefaultLayout(): ComparisonLayout {
  return {
    version: 3,
    yearRange: null,
    items: DEFAULT_KINDS.map((kind) => ({
      instanceId: crypto.randomUUID(),
      kind,
    })),
  };
}
