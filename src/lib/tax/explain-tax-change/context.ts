// src/lib/tax/explain-tax-change/context.ts
// Build the CellDrillContext (source-label lookups) from an effective tree +
// projection years. Mirrors the pattern in income-tax-report.tsx's useMemo ctx.
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";

export function buildTaxDrillContext(
  tree: ClientData,
  years: ProjectionYear[],
): CellDrillContext {
  const accountNames: Record<string, string> = {};
  for (const a of tree.accounts) accountNames[a.id] = a.name;
  for (const y of years) {
    for (const s of y.syntheticAccounts ?? []) accountNames[s.id] ??= s.name;
  }
  const entityNames: Record<string, string> = {};
  for (const e of tree.entities ?? []) if (e.name) entityNames[e.id] = e.name;
  const rothConversionNames: Record<string, string> = {};
  for (const r of tree.rothConversions ?? []) if (r.name) rothConversionNames[r.id] = r.name;
  const noteNames: Record<string, string> = {};
  for (const n of tree.notesReceivable ?? []) if (n.name) noteNames[n.id] = n.name;
  return {
    accountNames,
    incomes: tree.incomes,
    accounts: tree.accounts,
    entityNames,
    rothConversionNames,
    noteNames,
  };
}
