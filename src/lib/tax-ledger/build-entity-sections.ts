// src/lib/tax-ledger/build-entity-sections.ts
import type { ProjectionYear } from "@/engine/types";
import type { EntityCashFlowRow } from "@/engine/entity-cashflow";
import type { TaxLedgerRow, TaxLedgerSection } from "./types";
import { subtotalByCharacter } from "./_shared";

const PASS_THROUGH_BUSINESS = new Set(["llc", "s_corp", "partnership"]);

function finalize(id: string, label: string, kind: TaxLedgerSection["kind"], passThrough: boolean, rows: TaxLedgerRow[]): TaxLedgerSection {
  rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    id, label, kind, passThrough, rows,
    characterSubtotals: subtotalByCharacter(rows),
    subtotal: rows.reduce((s, r) => s + r.amount, 0),
    unreconciled: false,
  };
}

function buildBusiness(row: Extract<EntityCashFlowRow, { kind: "business" }>): TaxLedgerSection | null {
  if (row.income === 0 && row.expenses === 0 && row.annualDistribution === 0) return null;
  const passThrough = PASS_THROUGH_BUSINESS.has(row.entityType);
  const rows: TaxLedgerRow[] = [];
  if (row.income !== 0) rows.push({ type: "Business Income", description: row.entityName, character: "ordinary", account: null, amount: row.income, taxable: true });
  if (row.expenses !== 0) rows.push({ type: "Business Expenses", description: row.entityName, character: "deduction", account: null, amount: -Math.abs(row.expenses), taxable: false });
  if (passThrough) {
    const net = row.income - row.expenses;
    rows.push({ type: "Pass-Thru to Household", description: "Net K-1 income taxed on the household 1040", character: "ordinary", account: null, amount: -net, taxable: false });
  }
  return finalize(row.entityId, row.entityName, "business", passThrough, rows);
}

function buildTrust(row: Extract<EntityCashFlowRow, { kind: "trust" }>): TaxLedgerSection | null {
  if (row.income === 0 && row.totalDistributions === 0 && row.expenses === 0) return null;
  const rows: TaxLedgerRow[] = [];
  if (row.income !== 0) rows.push({ type: "Trust Income", description: row.entityName, character: "ordinary", account: null, amount: row.income, taxable: true });
  if (row.expenses !== 0) rows.push({ type: "Trust Expenses", description: row.entityName, character: "deduction", account: null, amount: -Math.abs(row.expenses), taxable: false });

  if (row.isGrantor) {
    // Grantor trust: the grantor reports both the trust's income AND its
    // deductions on their household 1040, so the trust is a pure conduit.
    // Pass through the NET (income − expenses) so the section subtotals to 0,
    // mirroring the pass-through business above.
    const net = row.income - row.expenses;
    rows.push({ type: "Pass-Thru to Grantor", description: "Taxed on the grantor's household 1040", character: "ordinary", account: null, amount: -net, taxable: false });
    return finalize(row.entityId, row.entityName, "trust", true, rows);
  }

  // Non-grantor trust: separate taxpayer. Distributions reduce retained income; the trust pays its own 1041 tax.
  if (row.totalDistributions !== 0) rows.push({ type: "Distributions", description: "Distributions to beneficiaries", character: "non_taxable", account: null, amount: -Math.abs(row.totalDistributions), taxable: false });
  if (row.taxes !== 0) rows.push({ type: "Trust 1041 Tax", description: "Tax paid by the trust", character: "non_taxable", account: null, amount: -Math.abs(row.taxes), taxable: false });
  return finalize(row.entityId, row.entityName, "trust", false, rows);
}

export function buildEntitySections(year: ProjectionYear): TaxLedgerSection[] {
  const out: TaxLedgerSection[] = [];
  for (const row of year.entityCashFlow.values()) {
    const section = row.kind === "business" ? buildBusiness(row) : buildTrust(row);
    if (section) out.push(section);
  }
  // Trusts (separate taxpayers) and businesses both appear; order by label for stability.
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
