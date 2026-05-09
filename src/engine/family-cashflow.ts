// src/engine/family-cashflow.ts
//
// Per-family-member locked-share ledger for jointly-held accounts. Mirrors
// the entity locked-share pattern in entity-cashflow.ts but for family↔family
// splits. Emits ProjectionYear.familyAccountSharesEoY so the balance sheet
// can render projected (drifted) ownership percentages instead of the static
// authored split.
//
// Drift drivers (per spec):
//   - Attributed income deposits → credit the income's owner share.
//   - Cash gifts (kind: "cash") → debit the grantor's share first, then
//     pull pro-rata from co-owners if grantor is exhausted.
//   - Death event → at next BoY, surviving owners absorb deceased's share
//     pro-rata to their pre-death shares.
//
// Everything else (passive growth, withdrawals, expenses, taxes, transfers,
// untagged deposits) moves pro-rata to current shares — preserves drift but
// doesn't drive it.

import type { ProjectionYear, Income, GiftEvent, FamilyMember } from "./types";

export interface ComputeFamilyAccountSharesInput {
  years: ProjectionYear[];
  /** Account → list of family-member owners. Only multi-owner accounts
   *  (≥2 entries) need a per-member ledger. */
  accountFamilyOwners: Map<string, Array<{ familyMemberId: string; percent: number }>>;
  /** Resolves "client" → familyMemberId for the household principal. */
  clientFamilyMemberId: string | null;
  /** Resolves "spouse" → familyMemberId. Null in single-filer plans. */
  spouseFamilyMemberId: string | null;
  /** Resolved incomes (same array runProjection built). Used to map
   *  income-category ledger entries back to their owner. */
  incomes: Income[];
  /** Resolved gift events (post-fanout). Cash gifts attribute to grantor. */
  gifts: GiftEvent[];
  /** Family-member metadata. Currently unused but reserved for richer
   *  death-event handling (e.g., resolving deceased name for warnings). */
  familyMembers: FamilyMember[];
}

/** Mutates input.years[].familyAccountSharesEoY in place. */
export function computeFamilyAccountShares(_input: ComputeFamilyAccountSharesInput): void {
  // Stub. Implemented incrementally in subsequent tasks.
}
