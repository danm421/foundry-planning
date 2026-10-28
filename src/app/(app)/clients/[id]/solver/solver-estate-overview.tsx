"use client";

// The estate dialog's landing pane: what the scenario currently holds, then
// every trust at a glance — its type, who gets what's left, and what funds it.
// Revocable living trusts are listed like any other trust; each row opens it.

import { remainderSummary, trustFundingSummary } from "@/lib/solver/trust-overview";
import { trustListRows } from "./solver-estate-rail";
import type { EstateEditor } from "./use-solver-estate-editor";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="tabular text-[20px] font-semibold text-ink">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</div>
    </div>
  );
}

const COLS = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-3";

export function SolverEstateOverview({ editor }: { editor: EstateEditor }) {
  const s = editor.summary;
  const tree = editor.clientData;
  const entities = new Map((tree.entities ?? []).map((e) => [e.id, e]));
  const revocable = new Map(editor.railRevocableTrusts.map((r) => [r.name, r]));
  const rows = trustListRows(editor.railTrusts, editor.railRevocableTrusts).map((row) => {
    const { pane } = row;
    if (pane.kind === "trust" && pane.id) {
      const entity = entities.get(pane.id);
      return {
        row,
        remainder: entity ? remainderSummary(entity, tree) : "—",
        funding: entity ? trustFundingSummary(entity, tree, editor.gifts) : "",
      };
    }
    const count = pane.kind === "revocable" ? (revocable.get(pane.name)?.accountIds.length ?? 0) : 0;
    return { row, remainder: "—", funding: `${count} account${count === 1 ? "" : "s"}` };
  });

  return (
    <div className="space-y-5 px-5 py-4">
      <div className="flex gap-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 py-3">
        <Stat label="Planned gifts" value={s.giftCount} />
        <Stat label="Trusts" value={s.trustCount} />
        <Stat label="Charities" value={s.charityCount} />
      </div>

      <section>
        <div className={`${COLS} px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3`}>
          <span>Trust</span>
          <span>Gets what&apos;s left</span>
          <span>Funding</span>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-hair px-3 py-4 text-center text-[13px] text-ink-4">
            No trusts yet.
          </p>
        ) : (
          <ul aria-label="Every trust" className="divide-y divide-hair rounded-[var(--radius-sm)] border border-hair">
            {rows.map(({ row, remainder, funding }) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => editor.setSelection(row.pane)}
                  className={`${COLS} w-full items-baseline px-3 py-2 text-left text-[13px] transition-colors hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60`}
                >
                  <span className="min-w-0 truncate text-ink" title={row.name}>
                    {row.name}
                    <span className="ml-1.5 text-ink-4">· {row.label}</span>
                  </span>
                  <span className="min-w-0 truncate text-ink-2" title={remainder}>
                    {remainder}
                  </span>
                  <span className="min-w-0 truncate text-ink-2" title={funding}>
                    {funding}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
