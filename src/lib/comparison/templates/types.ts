import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";

export const SLOT_TOKENS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type SlotToken = (typeof SLOT_TOKENS)[number];

export type SlotMapping = Partial<Record<SlotToken, string>>;

// A template layout is structurally a v5 layout, except widget.planIds entries
// are slot tokens rather than real scenario plan ids. We don't enforce this in
// the type system (the JSONB column is the same shape) — runtime helpers in
// resolve-slots / extract-slots are the source of truth.
export type TemplateLayoutV5 = ComparisonLayoutV5;

export interface ComparisonTemplate {
  key: string;
  name: string;
  description: string;
  slotCount: number;
  slotLabels: string[];
  layout: TemplateLayoutV5;
}

export function isSlotToken(s: string): s is SlotToken {
  return (SLOT_TOKENS as readonly string[]).includes(s);
}
