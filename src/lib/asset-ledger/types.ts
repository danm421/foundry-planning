// src/lib/asset-ledger/types.ts
import type { AccountLedgerEntry } from "@/engine/types";

/** Reuse the engine's own ledger-entry category union — single source of truth. */
export type FlowCategory = AccountLedgerEntry["category"];

export interface AssetRow {
  category: FlowCategory | "bookend";
  /** entry.label, e.g. "Growth", "RMD", "Supplemental withdrawal". */
  label: string;
  /** Signed: + inflow, − outflow. */
  amount: number;
  /** Signed basis delta (0 when the engine left it undefined). */
  basis: number;
  /** Resolved counterparty name for the "Other Account" column, if any. */
  counterpartyName?: string;
  /** True for synthesized Beginning/End-of-Year bookend rows. */
  bookend?: boolean;
  sourceId?: string;
  /** True for the source/target legs of pure portfolio-to-portfolio transfers. */
  internal: boolean;
}

export interface AssetAccountBlock {
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
  basisBoY: number;
  basisEoY: number;
  rothValueBoY?: number;
  rothValueEoY?: number;
  /** basisEoY − basisBoY − Σ(non-bookend row.basis). ~0 once all engine sites are populated. */
  basisResidual: number;
  /** Entries in the order the engine applied them, plus bookend rows prepended/appended. */
  rows: AssetRow[];
  /** |residual| ≤ $1. */
  reconciles: boolean;
  /** endingValue − beginningValue − Σ(non-bookend rows.amount). ≈0 normally; nonzero = engine bug. */
  residual: number;
}

export type OwnerKind = "household" | "trust" | "business" | "charity" | "individual";

export interface AssetOwnerSection {
  /** "household" or the entity id. */
  id: string;
  label: string;
  kind: OwnerKind;
  accounts: AssetAccountBlock[];
}

export interface AssetLedger {
  year: number;
  ages: { client: number; spouse?: number };
  sections: AssetOwnerSection[];
}

/** Name/owner lookup context the report assembles from ClientData + projection. */
export interface AssetLedgerContext {
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
