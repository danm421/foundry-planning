// src/components/asset-ledger/asset-ledger-table.tsx
"use client";

import MoneyText from "@/components/money-text";
import {
  FLOW_CATEGORY_LABEL,
  type AssetAccountBlock,
  type AssetLedger,
  type AssetOwnerSection,
  type AssetRow,
} from "@/lib/asset-ledger";
import type { AssetFilterState } from "./asset-ledger-filters";

const COLSPAN = 3;

function visibleRows(block: AssetAccountBlock, f: AssetFilterState): AssetRow[] {
  return block.rows.filter((r) => {
    if (f.categories.size > 0 && !f.categories.has(r.category)) return false;
    if (f.hideZero && r.amount === 0) return false;
    return true;
  });
}

function AccountBlock({ block, f }: { block: AssetAccountBlock; f: AssetFilterState }) {
  const rows = visibleRows(block, f);
  return (
    <>
      {/* Account header — always rendered so beginning→ending + reconcile badge stay visible. */}
      <tr>
        <td colSpan={COLSPAN} className="border-b border-hair bg-card-2 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink">
              {block.name}
              <span className="ml-2 rounded bg-card px-1.5 py-0.5 text-[11px] font-normal text-ink-3">{block.category}</span>
              {!block.reconciles && (
                <span className="ml-2 text-[11px] font-normal text-crit">
                  ⚠ off by <MoneyText value={block.residual} />
                </span>
              )}
            </span>
            <span className="text-xs tabular-nums text-ink-2">
              <MoneyText value={block.beginningValue} /> → <MoneyText value={block.endingValue} />
              <span className="ml-2 text-ink-3">
                (<MoneyText value={block.netChange} />)
              </span>
            </span>
          </div>
        </td>
      </tr>

      {rows.map((r, i) => (
        <tr key={`${block.id}-${i}`}>
          <td className="border-b border-hair bg-card px-3 py-1.5">
            <span className="inline-block rounded bg-card-2 px-1.5 py-0.5 text-[11px] text-ink-2">
              {FLOW_CATEGORY_LABEL[r.category]}
            </span>
          </td>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-ink-2">
            {r.label}
            {r.internal && (
              <span className="ml-2 rounded bg-card-2 px-1 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                internal
              </span>
            )}
          </td>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-right tabular-nums">
            <MoneyText value={r.amount} />
          </td>
        </tr>
      ))}

      {/* Per-account summary sub-header. */}
      <tr>
        <td colSpan={COLSPAN} className="border-b border-hair-2 bg-card px-3 py-1.5">
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-ink-3">
            {(
              [
                ["Growth", block.summary.growth],
                ["Contributions", block.summary.contributions],
                ["Distributions", block.summary.distributions],
                ["RMD", block.summary.rmd],
                ["Fees", block.summary.fees],
              ] as [string, number][]
            )
              .filter(([, v]) => Math.abs(v) > 0.5)
              .map(([lbl, v]) => (
                <span key={lbl}>
                  {lbl} <span className="font-medium tabular-nums text-ink-2"><MoneyText value={v} /></span>
                </span>
              ))}
          </div>
        </td>
      </tr>
    </>
  );
}

function OwnerSection({ section, f }: { section: AssetOwnerSection; f: AssetFilterState }) {
  return (
    <>
      <tr>
        <td colSpan={COLSPAN} className="bg-card px-3 py-2 text-[13px] font-semibold uppercase tracking-wider text-ink">
          {section.label}
        </td>
      </tr>
      {section.accounts.map((b) => (
        <AccountBlock key={b.id} block={b} f={f} />
      ))}
    </>
  );
}

export default function AssetLedgerTable({ ledger, filter }: { ledger: AssetLedger; filter: AssetFilterState }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-card">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            {["Category", "Description", "Amount"].map((h, i) => (
              <th
                key={h}
                className={`border-b border-hair bg-card-2 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wider text-ink ${
                  i === 2 ? "text-right" : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink">
          {ledger.sections.map((s) => (
            <OwnerSection key={s.id} section={s} f={filter} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
