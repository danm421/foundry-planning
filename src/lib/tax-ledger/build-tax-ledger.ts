// src/lib/tax-ledger/build-tax-ledger.ts
import type { ProjectionYear } from "@/engine/types";
import type { FilingStatus } from "@/lib/tax/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { buildHouseholdSection } from "./build-household-section";
import { buildEntitySections } from "./build-entity-sections";
import { buildDiagnostics } from "./build-diagnostics";
import type { TaxLedger } from "./types";

export interface BuildTaxLedgerOptions {
  householdLabel: string;
  filingStatus: FilingStatus;
}

export function buildTaxLedger(year: ProjectionYear, ctx: CellDrillContext, opts: BuildTaxLedgerOptions): TaxLedger {
  const household = buildHouseholdSection(year, ctx, opts.householdLabel);
  const entities = buildEntitySections(year);
  return {
    year: year.year,
    sections: [household, ...entities],
    diagnostics: buildDiagnostics(year, opts.filingStatus),
  };
}
