// src/lib/tax-ledger/build-household-section.ts
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { parseHouseholdSource } from "./parse-source";
import type { TaxCharacter, TaxLedgerRow, TaxLedgerSection } from "./types";

const RECON_TOLERANCE = 1; // dollars

/** Characters that taxDetail buckets cover (SS + deductions handled separately). */
const RECONCILED: TaxCharacter[] = [
  "earned",
  "ordinary",
  "qualified_dividends",
  "long_term_gain",
  "short_term_gain",
  "tax_exempt",
];

function expectedByCharacter(td: NonNullable<ProjectionYear["taxDetail"]>): Record<TaxCharacter, number> {
  return {
    earned: td.earnedIncome,
    // QBI is mapped to ordinary character, so its bucket joins ordinary here.
    ordinary: td.ordinaryIncome + td.qbi,
    qualified_dividends: td.dividends,
    long_term_gain: td.capitalGains,
    short_term_gain: td.stCapitalGains,
    tax_exempt: td.taxExempt,
    social_security: 0,
    deduction: 0,
    non_taxable: 0,
  };
}

export function buildHouseholdSection(
  year: ProjectionYear,
  ctx: CellDrillContext,
  householdLabel: string,
): TaxLedgerSection {
  const rows: TaxLedgerRow[] = [];
  const td = year.taxDetail;

  // 1. Income events from taxDetail.bySource.
  const bySource = td?.bySource ?? {};
  for (const [key, entry] of Object.entries(bySource)) {
    if (entry.amount === 0) continue;
    rows.push(parseHouseholdSource(key, entry, ctx));
  }

  // 2. Social Security (gross is not in bySource).
  const ss = year.income.socialSecurity;
  if (ss > 0) {
    const taxablePortion = year.taxResult?.income.taxableSocialSecurity ?? 0;
    rows.push({
      type: "Social Security",
      description: taxablePortion > 0 ? `${Math.round((taxablePortion / ss) * 100)}% taxable` : "Not taxable this year",
      character: "social_security",
      account: null,
      amount: ss,
      taxable: taxablePortion > 0,
    });
  }

  // 3. Deductions / contributions (negative rows).
  for (const v of Object.values(year.deductionBreakdown?.aboveLine.bySource ?? {})) {
    if (v.amount === 0) continue;
    rows.push({ type: "Above-Line Deduction", description: v.label, character: "deduction", account: null, amount: -Math.abs(v.amount), taxable: false });
  }
  for (const v of Object.values(year.deductionBreakdown?.belowLine.bySource ?? {})) {
    if (v.amount === 0) continue;
    rows.push({ type: "Itemized / Deduction", description: v.label, character: "deduction", account: null, amount: -Math.abs(v.amount), taxable: false });
  }

  // 4. Reconciliation: add an Unattributed row per character where bySource
  //    doesn't sum to the taxDetail bucket (e.g. portfolio LTCG has no key).
  let unreconciled = false;
  if (td) {
    const expected = expectedByCharacter(td);
    for (const c of RECONCILED) {
      const actual = rows.filter((r) => r.character === c).reduce((s, r) => s + r.amount, 0);
      const drift = expected[c] - actual;
      if (Math.abs(drift) > RECON_TOLERANCE) {
        unreconciled = true;
        rows.push({ type: "Unattributed", description: "Not tied to a named source", character: c, account: null, amount: drift, taxable: c !== "tax_exempt" });
      }
    }
  }

  // 5. Sort by magnitude, compute subtotals.
  rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const characterSubtotals = subtotalByCharacter(rows);
  const subtotal = rows.reduce((s, r) => s + r.amount, 0);

  return { id: "household", label: householdLabel, kind: "household", passThrough: false, rows, characterSubtotals, subtotal, unreconciled };
}

function subtotalByCharacter(rows: TaxLedgerRow[]): Partial<Record<TaxCharacter, number>> {
  const out: Partial<Record<TaxCharacter, number>> = {};
  for (const r of rows) out[r.character] = (out[r.character] ?? 0) + r.amount;
  return out;
}
