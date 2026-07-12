// src/lib/portal/__tests__/plaid-item-status.test.ts
import { describe, expect, it } from "vitest";
import { deriveItemStatus } from "@/lib/portal/plaid-item-status";

const base = {
  lastRefreshError: null as string | null,
  newAccountsAvailableAt: null as Date | null,
  transactionsCursor: "cursor_1" as string | null,
};

describe("deriveItemStatus", () => {
  it("healthy item: no flags set", () => {
    expect(deriveItemStatus(base)).toEqual({
      needsReauth: false, revoked: false, newAccountsAvailable: false, needsTransactionsConsent: false,
    });
  });
  it("ITEM_LOGIN_REQUIRED → needsReauth", () => {
    expect(deriveItemStatus({ ...base, lastRefreshError: "ITEM_LOGIN_REQUIRED" }).needsReauth).toBe(true);
  });
  it("USER_PERMISSION_REVOKED → revoked, not needsReauth", () => {
    const s = deriveItemStatus({ ...base, lastRefreshError: "USER_PERMISSION_REVOKED" });
    expect(s.revoked).toBe(true);
    expect(s.needsReauth).toBe(false);
  });
  it("newAccountsAvailableAt set → newAccountsAvailable", () => {
    expect(deriveItemStatus({ ...base, newAccountsAvailableAt: new Date(0) }).newAccountsAvailable).toBe(true);
  });
  it("null transactionsCursor → needsTransactionsConsent", () => {
    expect(deriveItemStatus({ ...base, transactionsCursor: null }).needsTransactionsConsent).toBe(true);
  });
});
