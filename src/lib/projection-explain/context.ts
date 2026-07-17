// src/lib/projection-explain/context.ts
// Build the DrillContext (source-label lookups + provenance maps) from an
// effective tree + projection years. Mirrors the pattern in
// income-tax-report.tsx's useMemo ctx, extended with savings/Roth provenance.
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { DrillContext } from "./types";

export function buildDrillContext(
  tree: ClientData,
  years: ProjectionYear[],
): DrillContext {
  const accountNames: Record<string, string> = {};
  const accountSeedRoth: Record<string, number> = {};
  const accountRothRollover: Record<string, boolean> = {};
  for (const a of tree.accounts) {
    accountNames[a.id] = a.name;
    accountSeedRoth[a.id] = a.rothValue ?? 0;
    accountRothRollover[a.id] = a.education529?.rothRolloverEnabled ?? false;
  }
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
    savingsRules: tree.savingsRules ?? [],
    accountSeedRoth,
    accountRothRollover,
  };
}
