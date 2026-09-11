import type { AssembleAssumption, PlanBasicsProvenance } from "@/lib/imports/assemble/types";
import { FieldTooltip } from "@/components/forms/field-tooltip";

export interface ChipAssumption extends AssembleAssumption {
  /** Provenance of the underlying field, when the call-site knows it. Absent for
   *  assumptions read back out of the persisted payload, which never stored one. */
  provenance?: PlanBasicsProvenance;
}

interface AssumedChipProps {
  /** The assumption for this field, or undefined/null when the value was extracted (renders nothing). */
  assumption?: ChipAssumption;
  /**
   * Whether the pill carries its `FieldTooltip`. Defaults to `true`, which is
   * every existing call-site's behaviour unchanged.
   *
   * Pass `false` where the chip renders INSIDE another interactive control:
   * the tooltip is a `<button>`, and a button inside a button is nested
   * interactive content (WCAG 4.1.2) whose inner click also bubbles to the
   * outer one. The statement-chat Owner cell is that case — making it
   * click-to-edit wraps its whole display in a button — and it shows the
   * reason in its own editor instead. Suppressing the tooltip, NOT the pill:
   * the pill is the at-a-glance "this value is a guess" signal, which an
   * editable cell needs more, not less.
   */
  withTooltip?: boolean;
}

/**
 * Small pill marking a gap-filled field so it isn't mistaken for an
 * extracted fact. Renders nothing when there's no assumption for the
 * field (the value came from extraction, not a default) — call-sites can
 * render it unconditionally without ternary noise.
 *
 * A field the LLM ESTIMATED from outside the uploaded document gets a
 * visually distinct (crit, not warn) treatment: it needs more advisor
 * scrutiny than an ordinary derived default.
 */
export default function AssumedChip({ assumption, withTooltip = true }: AssumedChipProps) {
  if (!assumption) return null;

  const isEstimated = assumption.provenance === "estimated";
  const label = isEstimated ? "Estimate" : "Assumed";
  const tooltipText = isEstimated
    ? `Model estimate — verify before presenting. ${assumption.reason}`
    : assumption.reason;
  const toneClasses = isEstimated
    ? "bg-crit/15 text-crit border-crit/30"
    : "bg-warn/15 text-warn border-warn/30";

  return (
    <span
      data-testid="assumed-chip"
      data-provenance={assumption.provenance}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${toneClasses}`}
    >
      {label}
      {withTooltip ? <FieldTooltip text={tooltipText} /> : null}
    </span>
  );
}
