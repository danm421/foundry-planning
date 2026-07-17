// src/lib/tax-ledger/build-household-section.ts
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { isTaxableCharacter } from "./character";
import { parseHouseholdSource } from "./parse-source";
import { subtotalByCharacter } from "./_shared";
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

  // 2. Social Security (gross is not in bySource) — split into taxable +
  //    non-taxable rows so the section subtotals tie to the income report
  //    (taxable → "Total Income", gross → "Gross Total Income") instead of a
  //    single gross row that matches neither column.
  const ss = year.income.socialSecurity;
  if (ss > 0) {
    const taxablePortion = Math.min(ss, year.taxResult?.income.taxableSocialSecurity ?? 0);
    const pct = Math.round((taxablePortion / ss) * 100);
    if (taxablePortion > 0) {
      rows.push({
        type: "Social Security",
        description: `Taxable portion (${pct}% of gross)`,
        character: "social_security",
        account: null,
        amount: taxablePortion,
        taxable: true,
      });
    }
    const nonTaxablePortion = ss - taxablePortion;
    if (nonTaxablePortion > 0) {
      rows.push({
        type: "Social Security",
        description: taxablePortion > 0 ? `Non-taxable portion (${100 - pct}% of gross)` : "Not taxable this year",
        character: "non_taxable",
        account: null,
        amount: nonTaxablePortion,
        taxable: false,
      });
    }
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

  // 5. Sort by magnitude, compute subtotals. taxableSubtotal ties to the
  //    income report's "Total Income"; grossSubtotal to "Gross Total Income".
  rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const characterSubtotals = subtotalByCharacter(rows);
  const characterEntries = Object.entries(characterSubtotals) as [TaxCharacter, number][];
  const subtotal = characterEntries.reduce((s, [, v]) => s + v, 0);
  const taxableSubtotal = characterEntries
    .filter(([c]) => isTaxableCharacter(c))
    .reduce((s, [, v]) => s + v, 0);
  const grossSubtotal = characterEntries
    .filter(([c]) => c !== "deduction")
    .reduce((s, [, v]) => s + v, 0);

  return { id: "household", label: householdLabel, kind: "household", passThrough: false, rows, characterSubtotals, subtotal, taxableSubtotal, grossSubtotal, unreconciled };
}
