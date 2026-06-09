// src/lib/flows-ledger/types.ts
import type { AccountLedgerEntry } from "@/engine/types";

/** Reuse the engine's own ledger-entry category union — single source of truth. */
export type FlowCategory = AccountLedgerEntry["category"];

export interface FlowsRow {
  category: FlowCategory;
  /** entry.label, e.g. "Growth", "RMD", "Supplemental withdrawal". */
  label: string;
  /** Signed: + inflow, − outflow. */
  amount: number;
  sourceId?: string;
  /** True for the source/target legs of pure portfolio-to-portfolio transfers. */
  internal: boolean;
}

export interface FlowsAccountBlock {
  id: string;
  name: string;
  /** Account category (taxable/cash/retirement/real_estate/business/…). */
  category: string;
  beginningValue: number;
  endingValue: number;
  netChange: number;
  summary: {
    growth: number;
    contributions: number;
    distributions: number;
    rmd: number;
    fees: number;
    internalContributions: number;
    internalDistributions: number;
  };
  /** Entries in the order the engine applied them. */
  rows: FlowsRow[];
  /** |residual| ≤ $1. */
  reconciles: boolean;
  /** endingValue − beginningValue − Σ rows.amount. ≈0 normally; nonzero = engine bug. */
  residual: number;
}

export type OwnerKind = "household" | "trust" | "business" | "charity" | "individual";

export interface FlowsOwnerSection {
  /** "household" or the entity id. */
  id: string;
  label: string;
  kind: OwnerKind;
  accounts: FlowsAccountBlock[];
}

export interface FlowsLedger {
  year: number;
  ages: { client: number; spouse?: number };
  sections: FlowsOwnerSection[];
}

/** Name/owner lookup context the report assembles from ClientData + projection. */
export interface FlowsLedgerContext {
  /** account id → display name (includes synthetic equity-comp accounts). */
  accountNames: Record<string, string>;
  /** account id → category (includes synthetic accounts). */
  accountCategories: Record<string, string>;
  /** entity id → display name. */
  entityNames: Record<string, string>;
  /** entity id → section kind. */
  entityKinds: Record<string, OwnerKind>;
  /** account id → entity owner. Absent ⇒ household-owned. */
  accountEntityOwners: Map<string, { entityId: string; percent: number }>;
}
