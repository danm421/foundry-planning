// src/components/tax-ledger/tax-ledger-table.tsx
"use client";

import MoneyText from "@/components/money-text";
import { CHARACTER_LABEL, isTaxableCharacter, type TaxCharacter, type TaxLedger, type TaxLedgerRow, type TaxLedgerSection } from "@/lib/tax-ledger";
import type { LedgerFilterState } from "./tax-ledger-filters";

function visibleRows(section: TaxLedgerSection, f: LedgerFilterState): TaxLedgerRow[] {
  return section.rows.filter((r) => {
    if (f.characters.size > 0 && !f.characters.has(r.character)) return false;
    if (f.hideNonTaxable && (r.character === "tax_exempt" || r.character === "non_taxable")) return false;
    if (f.hideZero && r.amount === 0) return false;
    return true;
  });
}

function CharacterTag({ row }: { row: TaxLedgerRow }) {
  return (
    <span className={`inline-block rounded bg-card-2 px-1.5 py-0.5 text-[11px] ${isTaxableCharacter(row.character) ? "text-ink-2" : "text-ink-3"}`}>
      {CHARACTER_LABEL[row.character]}
    </span>
  );
}

function Section({ section, f }: { section: TaxLedgerSection; f: LedgerFilterState }) {
  const rows = visibleRows(section, f);
  if (rows.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={5} className="bg-card-2 px-3 py-2 text-[13px] font-semibold uppercase tracking-wider text-ink">
          {section.label}
          {section.passThrough ? <span className="ml-2 text-[11px] font-normal normal-case text-ink-3">(pass-through)</span> : null}
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={`${section.id}-${i}`} className="group">
          <td className="border-b border-hair bg-card px-3 py-2 text-ink">{r.type}</td>
          <td className="border-b border-hair bg-card px-3 py-2 text-ink-2">{r.description}</td>
          <td className="border-b border-hair bg-card px-3 py-2"><CharacterTag row={r} /></td>
          <td className="border-b border-hair bg-card px-3 py-2 text-ink-2">{r.account ?? "—"}</td>
          <td className="border-b border-hair bg-card px-3 py-2 text-right tabular-nums"><MoneyText value={r.amount} /></td>
        </tr>
      ))}
      <tr>
        <td colSpan={5} className="border-b border-hair bg-card px-3 py-1.5">
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-ink-3">
            {(Object.entries(section.characterSubtotals) as [TaxCharacter, number][])
              .filter(([, v]) => Math.abs(v) > 0.5)
              .map(([c, v]) => (
                <span key={c}>
                  {CHARACTER_LABEL[c]} <span className="font-medium tabular-nums text-ink-2"><MoneyText value={v} /></span>
                </span>
              ))}
          </div>
        </td>
      </tr>
      {section.taxableSubtotal != null && section.grossSubtotal != null ? (
        <>
          <tr>
            <td colSpan={4} className="border-b border-hair bg-card-2 px-3 py-1.5 text-right text-xs font-medium text-ink-2">
              {section.label} taxable income
              {section.unreconciled ? <span className="ml-2 text-crit">⚠ includes unattributed amounts</span> : null}
            </td>
            <td className="border-b border-hair bg-card-2 px-3 py-1.5 text-right text-sm font-semibold tabular-nums"><MoneyText value={section.taxableSubtotal} /></td>
          </tr>
          <tr>
            <td colSpan={4} className="border-b border-hair-2 bg-card-2 px-3 py-1.5 text-right text-xs font-medium text-ink-3">
              {section.label} gross income
            </td>
            <td className="border-b border-hair-2 bg-card-2 px-3 py-1.5 text-right text-sm font-medium tabular-nums text-ink-2"><MoneyText value={section.grossSubtotal} /></td>
          </tr>
        </>
      ) : (
        <tr>
          <td colSpan={4} className="border-b border-hair-2 bg-card-2 px-3 py-1.5 text-right text-xs font-medium text-ink-2">
            {section.label} net taxable
            {section.unreconciled ? <span className="ml-2 text-crit">⚠ includes unattributed amounts</span> : null}
          </td>
          <td className="border-b border-hair-2 bg-card-2 px-3 py-1.5 text-right text-sm font-semibold tabular-nums"><MoneyText value={section.subtotal} /></td>
        </tr>
      )}
    </>
  );
}

export default function TaxLedgerTable({ ledger, filter }: { ledger: TaxLedger; filter: LedgerFilterState }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-card">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            {["Type", "Description", "Tax Character", "Account", "Amount"].map((h, i) => (
              <th key={h} className={`border-b border-hair bg-card-2 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wider text-ink ${i === 4 ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink">
          {ledger.sections.map((s) => (
            <Section key={s.id} section={s} f={filter} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
