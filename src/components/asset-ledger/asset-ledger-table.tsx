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

/** Transparent gap row used to separate stacked account blocks. */
function SpacerRow({ height = "h-3" }: { height?: string }) {
  return (
    <tr aria-hidden>
      <td colSpan={COLSPAN} className={height} />
    </tr>
  );
}

function visibleRows(block: AssetAccountBlock, f: AssetFilterState): AssetRow[] {
  return block.rows.filter((r) => {
    if (r.bookend) return true;
    if (f.hideZero && Math.round(r.amount) === 0) return false;
    return true;
  });
}

function AccountBlock({
  block,
  f,
  index,
}: {
  block: AssetAccountBlock;
  f: AssetFilterState;
  index: number;
}) {
  const rows = visibleRows(block, f);
  return (
    <>
      {/* Breathing room between stacked accounts (not before the first one in a section). */}
      {index > 0 && <SpacerRow />}

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
        <tr
          key={`${block.id}-${r.label}`}
          className={`hover:[&>td]:shadow-[inset_0_1px_0_var(--color-hair-2),inset_0_-1px_0_var(--color-hair-2)] ${
            r.bookend ? "font-semibold" : ""
          }`}
        >
          {/* Detail label indented so it reads as subordinate to the account header above. */}
          <td className="border-b border-hair bg-card py-1.5 pl-7 pr-3 text-ink">
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

function OwnerSection({
  section,
  f,
  index,
}: {
  section: AssetOwnerSection;
  f: AssetFilterState;
  index: number;
}) {
  return (
    <>
      {index > 0 && <SpacerRow height="h-5" />}
      <tr>
        <td colSpan={COLSPAN} className="bg-card px-3 py-2 text-[13px] font-semibold uppercase tracking-wider text-ink">
          {section.label}
        </td>
      </tr>
      {section.accounts.map((b, i) => (
        <AccountBlock key={b.id} block={b} f={f} index={i} />
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
          {ledger.sections.map((s, i) => (
            <OwnerSection key={s.id} section={s} f={filter} index={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
