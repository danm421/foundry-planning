import { FieldHintPopover } from "foundry-planning";
import type { ReactNode } from "react";

function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-start bg-paper text-ink font-sans p-6">
      {children}
    </div>
  );
}

function Row({
  label,
  hintLabel,
  rows,
  value,
}: {
  label: string;
  hintLabel: string;
  rows: { term?: string; value: string }[];
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
        {label}
        <FieldHintPopover label={hintLabel} rows={rows} />
      </span>
      <span className="tabular text-[13px] text-ink">{value}</span>
    </div>
  );
}

/**
 * Resting composition. FieldHintPopover opens on hover / focus via internal
 * state and renders its box in a document.body portal (position: fixed) — that
 * open state can't be forced from props, so a static screenshot shows the badge
 * at rest inside each solver row.
 */
export function InSolverRow() {
  return (
    <Canvas>
      <div className="w-[420px] space-y-3 rounded-[var(--radius)] border border-hair bg-card p-5">
        <h3 className="text-[14px] font-semibold text-ink">Social Security</h3>
        <Row
          label="Claiming age"
          hintLabel="Claiming-age detail"
          value="67"
          rows={[
            { term: "Full retirement", value: "67" },
            { term: "Monthly benefit", value: "$3,240" },
            { term: "If delayed to 70", value: "$4,018" },
          ]}
        />
        <Row
          label="COLA assumption"
          hintLabel="COLA detail"
          value="2.4%"
          rows={[
            { value: "Benefits grow with CPI-W each year." },
            { term: "Assumed COLA", value: "2.4%" },
          ]}
        />
        <p className="text-[12px] text-ink-3">
          Each ? opens the underlying figures beside the row.
        </p>
      </div>
    </Canvas>
  );
}
