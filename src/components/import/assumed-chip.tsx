import type { AssembleAssumption } from "@/lib/imports/assemble/types";
import { FieldTooltip } from "@/components/forms/field-tooltip";

interface AssumedChipProps {
  /** The assumption for this field, or undefined/null when the value was extracted (renders nothing). */
  assumption?: AssembleAssumption;
}

/**
 * Small pill marking a gap-filled field so it isn't mistaken for an
 * extracted fact. Renders nothing when there's no assumption for the
 * field (the value came from extraction, not a default) — call-sites can
 * render it unconditionally without ternary noise.
 */
export default function AssumedChip({ assumption }: AssumedChipProps) {
  if (!assumption) return null;

  return (
    <span
      data-testid="assumed-chip"
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium bg-warn/15 text-warn border-warn/30"
    >
      Assumed
      <FieldTooltip text={assumption.reason} />
    </span>
  );
}
