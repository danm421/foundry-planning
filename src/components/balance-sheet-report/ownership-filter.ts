// src/components/balance-sheet-report/ownership-filter.ts
//
// View enum for the balance-sheet report's ownership tabs. The slice-based
// view-model handles per-view filtering directly off `owners[]`, so the old
// `filterAccounts` / `filterLiabilities` helpers were retired.

export type OwnershipView =
  | "consolidated"
  | "client"
  | "spouse"
  | "joint"
  | "entities";
