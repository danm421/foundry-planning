// src/components/asset-ledger/asset-ledger-table.tsx
"use client";

import MoneyText from "@/components/money-text";
import type {
  AssetAccountBlock,
  AssetLedger,
  AssetOwnerSection,
  AssetRow,
} from "@/lib/asset-ledger";
import type { AssetFilterState } from "./asset-ledger-filters";

/** Column headers; index >= 2 (Amount, Basis) right-aligns. COLSPAN derives from this. */
const HEADERS = ["Description", "Other Account", "Amount", "Basis"];
const COLSPAN = HEADERS.length;

function visibleRows(block: AssetAccountBlock, f: AssetFilterState): AssetRow[] {
  return block.rows.filter((r) => {
    if (r.bookend) return true;
    if (f.hideZero && Math.round(r.amount) === 0) return false;
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

      {rows.map((r) => (
        <tr key={`${block.id}-${r.label}`} className={r.bookend ? "font-semibold" : undefined}>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-ink">
            {r.label}
            {!r.bookend && r.internal && (
              <span className="ml-2 rounded bg-card-2 px-1 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                internal
              </span>
            )}
          </td>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-ink-2">
            {r.counterpartyName ?? ""}
          </td>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-right tabular-nums">
            <MoneyText value={r.amount} format="accounting" />
          </td>
          <td className="border-b border-hair bg-card px-3 py-1.5 text-right tabular-nums">
            <MoneyText value={r.basis} format="accounting" />
          </td>
        </tr>
      ))}
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
            {HEADERS.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`border-b border-hair bg-card-2 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wider text-ink ${
                  i >= 2 ? "text-right" : "text-left"
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
