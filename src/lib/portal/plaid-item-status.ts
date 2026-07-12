// src/lib/portal/plaid-item-status.ts
import { REAUTH_CODES, REVOKED_CODES } from "@/lib/plaid/errors";

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
  const revoked = row.lastRefreshError != null && REVOKED_CODES.has(row.lastRefreshError);
  const needsReauth =
    !revoked && row.lastRefreshError != null && REAUTH_CODES.has(row.lastRefreshError);
  return {
    revoked,
    needsReauth,
    newAccountsAvailable: row.newAccountsAvailableAt != null,
    needsTransactionsConsent: row.transactionsCursor == null,
  };
}
