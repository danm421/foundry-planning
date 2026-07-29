import type { RiskListFlags } from "@/lib/risk/queries";

// Neutral status vs. a warning that means the plan or allocation itself needs
// advisor attention -- capacityConstrained and goalsOverReaching both say "the
// household is being asked to take more risk than its plan can bear."
// Exported so any other surface rendering one of these flags on its own (e.g.
// the risk detail page's inline "Review due" chip) reuses the same color
// classification instead of re-typing it and drifting from this table.
export const CHIP_NEUTRAL = "border-hair text-ink-2 bg-card-2";
export const CHIP_WARN = "border-warn/40 text-warn bg-warn/10";

const CHIP_SPECS: { key: keyof RiskListFlags; label: string; className: string }[] = [
  { key: "notEstablished", label: "Not established", className: CHIP_NEUTRAL },
  { key: "reviewDue", label: "Review due", className: CHIP_NEUTRAL },
  { key: "capacityConstrained", label: "Capacity-constrained", className: CHIP_WARN },
  { key: "goalsOverReaching", label: "Goals over-reaching", className: CHIP_WARN },
  { key: "capacityPending", label: "Capacity pending", className: CHIP_NEUTRAL },
];

/** One pill per true flag on `deriveListFlags`' output; a bare dash when none. */
export function RiskStatusChips({ flags }: { flags: RiskListFlags }) {
  const active = CHIP_SPECS.filter((spec) => flags[spec.key]);
  if (active.length === 0) return <span className="text-ink-3">—</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {active.map((spec) => (
        <span
          key={spec.key}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${spec.className}`}
        >
          {spec.label}
        </span>
      ))}
    </div>
  );
}
