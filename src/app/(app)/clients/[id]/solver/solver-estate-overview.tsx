"use client";

// The estate dialog's landing pane: what the scenario currently holds, plus the
// revocable living trust. The RLT is a household-level switch that retitles
// probate accounts — it is not an entity, so it does not belong in the rail's
// Trusts list.

import { FieldTooltip } from "@/components/forms/field-tooltip";
import { EstateRevocableTrustList } from "./solver-tab-estate-planning";
import type { EstateEditor } from "./use-solver-estate-editor";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="tabular text-[20px] font-semibold text-ink">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</div>
    </div>
  );
}

export function SolverEstateOverview({ editor }: { editor: EstateEditor }) {
  const s = editor.summary;
  return (
    <div className="space-y-5 px-5 py-4">
      <div className="flex gap-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
        <Stat label="Planned gifts" value={s.giftCount} />
        <Stat label="Trusts" value={s.trustCount} />
        <Stat label="Charities" value={s.charityCount} />
      </div>

      <section className="space-y-3">
        {/* The tooltip sits OUTSIDE the heading: nested, its "Show help" name
            would be appended to the heading's own accessible name. */}
        <div className="flex items-center gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            Revocable living trust
          </h3>
          <FieldTooltip text="Retitles the household's probate-exposed accounts into a revocable trust so they pass outside probate. It changes titling only — the assets stay in the taxable estate." />
        </div>
        <EstateRevocableTrustList
          enabled={editor.enabled}
          trustName={editor.trustName}
          eligible={editor.eligible}
          taggedIds={editor.taggedIds}
          onToggleEnabled={editor.toggleEnabled}
          onChangeName={editor.changeName}
          onToggleAccount={editor.toggleAccount}
          onSelectAll={editor.selectAll}
        />
      </section>
    </div>
  );
}
