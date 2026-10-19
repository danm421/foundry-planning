// src/lib/portal/plaid-item-status.ts
import { plaidIssueOf } from "@/lib/plaid/errors";

export interface PlaidItemStatusRow {
  lastRefreshError: string | null;
  newAccountsAvailableAt: Date | null;
  transactionsCursor: string | null;
}
export interface PlaidItemStatus {
  needsReauth: boolean;
  revoked: boolean;
  newAccountsAvailable: boolean;
  needsTransactionsConsent: boolean;
}

export function deriveItemStatus(row: PlaidItemStatusRow): PlaidItemStatus {
  const issue = plaidIssueOf(row.lastRefreshError);
  return {
    revoked: issue === "revoked",
    needsReauth: issue === "reconnect",
    newAccountsAvailable: row.newAccountsAvailableAt != null,
    needsTransactionsConsent: row.transactionsCursor == null,
  };
}
